import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_VERIFICATION_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

interface CreateAccountRequest {
  email: string;
  password: string;
  username: string;
  otp_code: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, password, username, otp_code }: CreateAccountRequest = await req.json();

    if (!email || !password || !username || !otp_code) {
      return new Response(
        JSON.stringify({ error: "Email, password, username, and verification code are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Validate inputs
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 6 characters" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (username.length < 3 || username.length > 20) {
      return new Response(
        JSON.stringify({ error: "Username must be between 3 and 20 characters" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!/^\d{6}$/.test(otp_code)) {
      return new Response(
        JSON.stringify({ error: "Invalid verification code format" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Step 1: Verify OTP server-side
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

    // Check lockout
    if (otpRecord.locked_until && new Date(otpRecord.locked_until) > new Date()) {
      const waitTime = Math.ceil(
        (new Date(otpRecord.locked_until).getTime() - Date.now()) / 60000
      );
      return new Response(
        JSON.stringify({ error: `Too many failed attempts. Please try again in ${waitTime} minutes.` }),
        { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check expiry
    if (new Date(otpRecord.expires_at) < new Date()) {
      await supabase.from("email_otp").delete().eq("id", otpRecord.id);
      return new Response(
        JSON.stringify({ error: "Verification code has expired. Please request a new one." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check code match
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

    // Step 2: OTP is valid - mark as verified
    await supabase
      .from("email_otp")
      .update({ verified: true })
      .eq("id", otpRecord.id);

    // Step 3: Create the user account using Admin API
    const { data: userData, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        display_name: username,
      },
    });

    if (createError) {
      // Revert OTP verification on failure
      await supabase
        .from("email_otp")
        .update({ verified: false })
        .eq("id", otpRecord.id);

      if (createError.message.includes('already been registered') || createError.message.includes('already registered')) {
        return new Response(
          JSON.stringify({ error: "An account with this email already exists" }),
          { status: 409, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      console.error("Error creating user:", createError);
      return new Response(
        JSON.stringify({ error: "Failed to create account. Please try again." }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Clean up OTP record
    await supabase.from("email_otp").delete().eq("id", otpRecord.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        user_id: userData.user.id,
        email: userData.user.email 
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in create-account function:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
