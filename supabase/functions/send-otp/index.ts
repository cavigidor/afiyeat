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

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

interface SendOTPRequest {
  email: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email }: SendOTPRequest = await req.json();

    if (!email) {
      throw new Error("Email is required");
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error("Invalid email format");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check rate limit
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
    
    const { data: rateLimitData, error: rateLimitError } = await supabase
      .from("otp_rate_limits")
      .select("*")
      .eq("email", email)
      .gte("window_start", windowStart)
      .order("window_start", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (rateLimitError) {
      console.error("Rate limit check error:", rateLimitError);
    }

    if (rateLimitData) {
      if (rateLimitData.request_count >= MAX_REQUESTS_PER_WINDOW) {
        const waitTime = Math.ceil(
          (new Date(rateLimitData.window_start).getTime() + RATE_LIMIT_WINDOW_MINUTES * 60 * 1000 - Date.now()) / 60000
        );
        return new Response(
          JSON.stringify({ 
            error: `Too many verification requests. Please try again in ${waitTime} minutes.` 
          }),
          {
            status: 429,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          }
        );
      }

      // Update request count
      await supabase
        .from("otp_rate_limits")
        .update({ request_count: rateLimitData.request_count + 1 })
        .eq("id", rateLimitData.id);
    } else {
      // Create new rate limit entry
      await supabase.from("otp_rate_limits").insert({
        email,
        request_count: 1,
        window_start: new Date().toISOString(),
      });
    }

    // Generate OTP code
    const code = generateOTP();

    // Delete any existing OTP for this email
    await supabase.from("email_otp").delete().eq("email", email);

    // Store the new OTP with verification attempts reset
    const { error: insertError } = await supabase.from("email_otp").insert({
      email,
      code,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
      verification_attempts: 0,
      locked_until: null,
    });

    if (insertError) {
      console.error("Failed to store OTP:", insertError);
      throw new Error("Failed to generate verification code");
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
          <p>This code will expire in 10 minutes.</p>
          <p style="color: #666; font-size: 14px;">If you didn't request this code, you can safely ignore this email.</p>
        </div>
      `,
    });

    console.log("OTP email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in send-otp function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
