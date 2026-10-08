import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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

type CodeCheck =
  | { ok: true }
  | { ok: false; status: number; message: string };

// Checks a code through otp_check_code, which locks the code row so that
// attempts are counted exactly and a correct code works only once (see
// migration otp_atomic_operations). consume=true deletes the code on
// success; consume=false only marks it verified.
async function checkCode(
  supabase: SupabaseClient,
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
    const body: CreateAccountRequest = await req.json();
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const otp_code = typeof body?.otp_code === "string" ? body.otp_code.trim() : "";

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

    // Step 1: verify and spend the code in one locked step, so the same
    // code can't create two accounts if submitted twice at once.
    const check = await checkCode(supabase, email, otp_code, true);
    if (!check.ok) {
      return new Response(
        JSON.stringify({ error: check.message }),
        { status: check.status, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Step 2: Create the user account using Admin API
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
      // The code has already been spent; the user requests a fresh one to
      // try again. Re-issuing the old code here would reopen the race the
      // locked check above exists to close.
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
