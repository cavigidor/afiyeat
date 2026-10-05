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

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: VerifyOTPRequest = await req.json();
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const code = typeof body?.code === "string" ? body.code.trim() : "";

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

    // A check without an action: mark verified rather than spend the code.
    const result = await checkCode(supabase, email, code, false);

    return new Response(
      JSON.stringify(result.ok ? { valid: true } : { valid: false, error: result.message }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  } catch (error: any) {
    console.error("Error in verify-otp function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
