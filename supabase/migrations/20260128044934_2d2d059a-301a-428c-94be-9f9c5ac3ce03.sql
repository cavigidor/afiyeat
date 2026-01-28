-- Create table to store OTP codes
CREATE TABLE public.email_otp (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '10 minutes'),
  verified BOOLEAN NOT NULL DEFAULT false
);

-- Create index for faster lookups
CREATE INDEX idx_email_otp_email ON public.email_otp(email);
CREATE INDEX idx_email_otp_expires_at ON public.email_otp(expires_at);

-- No RLS needed - this table is only accessed by edge functions with service role