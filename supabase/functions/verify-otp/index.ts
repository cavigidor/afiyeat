import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Rate limit configuration
const MAX_VERIFICATION_ATTEMPTS = 5; // Max 5 failed attempts per OTP
const LOCKOUT_MINUTES = 15; // Lock out for 15 minutes after max attempts

interface VerifyOTPRequest {
  email: string;
  code: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, code }: VerifyOTPRequest = await req.json();

    if (!email || !code) {
      throw new Error("Email and code are required");
    }

    // Validate code format (6 digits)
    if (!/^\d{6}$/.test(code)) {
      return new Response(JSON.stringify({ valid: false, error: "Invalid code format" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find the OTP record for this email (not yet verified)
    const { data: otpRecord, error: fetchError } = await supabase
      .from("email_otp")
      .select("*")
      .eq("email", email)
      .eq("verified", false)
      .single();

    if (fetchError || !otpRecord) {
      return new Response(JSON.stringify({ valid: false, error: "No pending verification found" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Check if locked out
    if (otpRecord.locked_until && new Date(otpRecord.locked_until) > new Date()) {
      const waitTime = Math.ceil(
        (new Date(otpRecord.locked_until).getTime() - Date.now()) / 60000
      );
      return new Response(
        JSON.stringify({ 
          valid: false, 
          error: `Too many failed attempts. Please try again in ${waitTime} minutes.` 
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Check if OTP has expired
    if (new Date(otpRecord.expires_at) < new Date()) {
      // Clean up expired OTP
      await supabase.from("email_otp").delete().eq("id", otpRecord.id);
      
      return new Response(JSON.stringify({ valid: false, error: "Verification code has expired" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Check if code matches
    if (otpRecord.code !== code) {
      const newAttempts = (otpRecord.verification_attempts || 0) + 1;
      
      if (newAttempts >= MAX_VERIFICATION_ATTEMPTS) {
        // Lock out the OTP
        const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
        await supabase
          .from("email_otp")
          .update({ 
            verification_attempts: newAttempts,
            locked_until: lockUntil
          })
          .eq("id", otpRecord.id);

        return new Response(
          JSON.stringify({ 
            valid: false, 
            error: `Too many failed attempts. Please request a new code after ${LOCKOUT_MINUTES} minutes.` 
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          }
        );
      }

      // Increment attempt counter
      await supabase
        .from("email_otp")
        .update({ verification_attempts: newAttempts })
        .eq("id", otpRecord.id);

      const remainingAttempts = MAX_VERIFICATION_ATTEMPTS - newAttempts;
      return new Response(
        JSON.stringify({ 
          valid: false, 
          error: `Invalid verification code. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining.` 
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Mark as verified
    await supabase
      .from("email_otp")
      .update({ verified: true })
      .eq("id", otpRecord.id);

    return new Response(JSON.stringify({ valid: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in verify-otp function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
