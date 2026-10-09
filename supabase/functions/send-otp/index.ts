import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Rate limit configuration
const MAX_REQUESTS_PER_WINDOW = 3; // Max 3 OTP requests per email
const RATE_LIMIT_WINDOW_MINUTES = 15; // 15 minute window

const CODE_TTL_MINUTES = 10;

// Cryptographically random 6-digit code. Math.random() is predictable
// enough that codes could in principle be guessed from earlier ones.
// Rejection sampling keeps every code equally likely (2^32 isn't a
// multiple of 900000, so a plain modulo would slightly favour some).
function generateOTP(): string {
  const range = 900000;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return (100000 + (buf[0] % range)).toString();
}

interface SendOTPRequest {
  email: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: SendOTPRequest = await req.json();
    // One spelling per address, so "Me@x.com" and "me@x.com" share a rate
    // limit and a code.
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email) {
      throw new Error("Email is required");
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email) || email.length > 254) {
      throw new Error("Invalid email format");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const code = generateOTP();

    // Rate-limit check and code replacement happen together in one locked
    // database call (see migration otp_atomic_operations), so simultaneous
    // requests can't slip past the limit or leave two live codes.
    const { data: issued, error: issueError } = await supabase.rpc("otp_issue_code", {
      p_email: email,
      p_code: code,
      p_max_requests: MAX_REQUESTS_PER_WINDOW,
      p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
      p_ttl_minutes: CODE_TTL_MINUTES,
    });

    if (issueError) {
      console.error("Failed to issue OTP:", issueError.message);
      throw new Error("Failed to generate verification code");
    }

    const result = Array.isArray(issued) ? issued[0] : issued;
    if (!result?.allowed) {
      const waitTime = result?.retry_after_minutes ?? RATE_LIMIT_WINDOW_MINUTES;
      return new Response(
        JSON.stringify({
          error: `Too many verification requests. Please try again in ${waitTime} minutes.`,
        }),
        {
          status: 429,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Send email with OTP
    const emailResponse = await resend.emails.send({
      from: "Afiyeat <noreply@afiyeat.com>",
      to: [email],
      subject: "Your Afiyeat verification code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">Verify your email</h1>
          <p>Your verification code is:</p>
          <div style="background-color: #f4f4f4; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333;">${code}</span>
          </div>
          <p>This code will expire in ${CODE_TTL_MINUTES} minutes.</p>
          <p style="color: #666; font-size: 14px;">If you didn't request this code, you can safely ignore this email.</p>
        </div>
      `,
    });

    if ((emailResponse as { error?: unknown })?.error) {
      console.error("OTP email failed to send:", (emailResponse as { error?: unknown }).error);
      throw new Error("Couldn't send the verification email. Please try again.");
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    console.error("Error in send-otp function:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Something went wrong" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
