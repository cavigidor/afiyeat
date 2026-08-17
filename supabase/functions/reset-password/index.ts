import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_VERIFICATION_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

interface ResetPasswordRequest {
  email: string;
  otp_code: string;
  new_password: string;
}

// Password reset via the app's existing email-OTP infrastructure, instead
// of Supabase's default magic-link flow. A native Capacitor app has no
// real web origin to redirect a clicked link back to (window.location.origin
// resolves to an internal capacitor://localhost address, which nothing on
// the device knows how to open from an email), so a tappable reset link
// silently fails for every native install. A 6-digit code typed directly
// into the app sidesteps that entirely - same pattern as sign-up.
const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, otp_code, new_password }: ResetPasswordRequest = await req.json();

    if (!email || !otp_code || !new_password) {
      return new Response(
        JSON.stringify({ error: "Email, verification code, and new password are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!/^\d{6}$/.test(otp_code)) {
      return new Response(
        JSON.stringify({ error: "Invalid verification code format" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (new_password.length < 6) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 6 characters" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Step 1: verify the OTP (same rules as sign-up: not expired, not
    // locked out, code matches - incrementing/locking attempts on failure).
    const { data: otpRecord, error: fetchError } = await supabase
      .from("email_otp")
      .select("*")
      .eq("email", email)
      .eq("verified", false)
      .single();

    if (fetchError || !otpRecord) {
      return new Response(
        JSON.stringify({ error: "No pending verification found. Please request a new code." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (otpRecord.locked_until && new Date(otpRecord.locked_until) > new Date()) {
      const waitTime = Math.ceil(
        (new Date(otpRecord.locked_until).getTime() - Date.now()) / 60000
      );
      return new Response(
        JSON.stringify({ error: `Too many failed attempts. Please try again in ${waitTime} minutes.` }),
        { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (new Date(otpRecord.expires_at) < new Date()) {
      await supabase.from("email_otp").delete().eq("id", otpRecord.id);
      return new Response(
        JSON.stringify({ error: "Verification code has expired. Please request a new one." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (otpRecord.code !== otp_code) {
      const newAttempts = (otpRecord.verification_attempts || 0) + 1;

      if (newAttempts >= MAX_VERIFICATION_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
        await supabase
          .from("email_otp")
          .update({ verification_attempts: newAttempts, locked_until: lockUntil })
          .eq("id", otpRecord.id);

        return new Response(
          JSON.stringify({ error: `Too many failed attempts. Please request a new code after ${LOCKOUT_MINUTES} minutes.` }),
          { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      await supabase
        .from("email_otp")
        .update({ verification_attempts: newAttempts })
        .eq("id", otpRecord.id);

      const remaining = MAX_VERIFICATION_ATTEMPTS - newAttempts;
      return new Response(
        JSON.stringify({ error: `Invalid verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Step 2: OTP is valid - find the account for this email. The admin SDK
    // has no direct "get user by email" call, so page through listUsers()
    // and match client-side - fine at this app's scale, and avoids relying
    // on the auth schema being exposed over PostgREST (it isn't, by
    // default).
    const normalizedEmail = email.trim().toLowerCase();
    let matchedUserId: string | null = null;
    for (let page = 1; page <= 20 && !matchedUserId; page++) {
      const { data: pageData, error: listError } = await supabase.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (listError || !pageData) break;

      const match = pageData.users.find((u) => u.email?.toLowerCase() === normalizedEmail);
      if (match) {
        matchedUserId = match.id;
        break;
      }
      if (pageData.users.length < 1000) break; // last page
    }

    if (!matchedUserId) {
      await supabase.from("email_otp").delete().eq("id", otpRecord.id);
      return new Response(
        JSON.stringify({ error: "No account found with this email address" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Step 3: set the new password.
    const { error: updateError } = await supabase.auth.admin.updateUserById(matchedUserId, {
      password: new_password,
    });

    if (updateError) {
      console.error("Failed to update password:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to reset password. Please try again." }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Clean up the OTP record now that it's been used.
    await supabase.from("email_otp").delete().eq("id", otpRecord.id);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    console.error("Error in reset-password function:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
