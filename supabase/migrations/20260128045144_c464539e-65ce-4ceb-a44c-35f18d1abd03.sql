-- Enable RLS on email_otp table
-- No policies needed - only edge functions with service role access this table
ALTER TABLE public.email_otp ENABLE ROW LEVEL SECURITY;