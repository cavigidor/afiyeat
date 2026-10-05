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

type CodeCheck =
  | { ok: true }
  | { ok: false; status: number; message: string };

// Checks a code through otp_check_code, which locks the code row so that
// attempts are counted exactly and a correct code works only once (see
// migration otp_atomic_operations). consume=true deletes the code on
// success; consume=false only marks it verified.
async function checkCode(
  supabase: ReturnType<typeof createClient>,
  email: string,
  code: string,
  consume: boolean,
): Promise<CodeCheck> {
  const { data, error } = await supabase.rpc("otp_check_code", {
    p_email: email,
    p_code: code,
    p_consume: consume,
    p_max_attempts: MAX_VERIFICATION_ATTEMPTS,
    p_lockout_minutes: LOCKOUT_MINUTES,
  });
  if (error) {
    console.error("otp_check_code failed:", error.message);
    return { ok: false, status: 500, message: "Couldn't check the verification code. Please try again." };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { status: string; remaining_attempts: number; retry_after_minutes: number }
    | null;

  switch (row?.status) {
    case "ok":
      return { ok: true };
    case "locked":
      return {
        ok: false,
        status: 429,
        message: `Too many failed attempts. Please try again in ${row.retry_after_minutes} minutes.`,
      };
    case "locked_now":
      return {
        ok: false,
        status: 429,
        message: `Too many failed attempts. Please request a new code after ${LOCKOUT_MINUTES} minutes.`,
      };
    case "expired":
      return { ok: false, status: 400, message: "Verification code has expired. Please request a new one." };
    case "invalid": {
      const remaining = row.remaining_attempts;
      return {
        ok: false,
        status: 400,
        message: `Invalid verification code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
      };
    }
    default:
      return { ok: false, status: 400, message: "No pending verification found. Please request a new code." };
  }
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
    const body: ResetPasswordRequest = await req.json();
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const otp_code = typeof body?.otp_code === "string" ? body.otp_code.trim() : "";
    const new_password = typeof body?.new_password === "string" ? body.new_password : "";

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

    // Step 1: verify and spend the code in one locked step, so one code
    // can't be used for two resets submitted at the same moment.
    const check = await checkCode(supabase, email, otp_code, true);
    if (!check.ok) {
      return new Response(
        JSON.stringify({ error: check.message }),
        { status: check.status, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Step 2: find the account for this email with a direct indexed
    // lookup (auth_user_id_by_email) instead of paging through every user.
    const { data: matchedUserId, error: lookupError } = await supabase.rpc("auth_user_id_by_email", {
      p_email: email,
    });

    if (lookupError) {
      console.error("Account lookup failed:", lookupError.message);
      return new Response(
        JSON.stringify({ error: "Failed to reset password. Please try again." }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!matchedUserId) {
      return new Response(
        JSON.stringify({ error: "No account found with this email address" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Step 3: set the new password.
    const { error: updateError } = await supabase.auth.admin.updateUserById(matchedUserId as string, {
      password: new_password,
    });

    if (updateError) {
      console.error("Failed to update password:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to reset password. Please try again." }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

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
