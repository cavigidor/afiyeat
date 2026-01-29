-- Add attempt tracking columns to email_otp table
ALTER TABLE public.email_otp 
ADD COLUMN IF NOT EXISTS verification_attempts integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS locked_until timestamp with time zone;

-- Add index for faster lookups on email
CREATE INDEX IF NOT EXISTS idx_email_otp_email ON public.email_otp(email);

-- Create a table to track OTP request rate limiting
CREATE TABLE IF NOT EXISTS public.otp_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  request_count integer DEFAULT 1,
  window_start timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS (accessed only by edge functions with service role)
ALTER TABLE public.otp_rate_limits ENABLE ROW LEVEL SECURITY;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_otp_rate_limits_email ON public.otp_rate_limits(email);