-- Deny all direct access to email_otp table
-- OTP operations are handled by edge functions using service role

-- Deny SELECT - no one should read OTP codes directly
CREATE POLICY "Deny all SELECT access"
ON public.email_otp
FOR SELECT
USING (false);

-- Deny INSERT - only edge functions with service role should create OTPs
CREATE POLICY "Deny all INSERT access"
ON public.email_otp
FOR INSERT
WITH CHECK (false);

-- Deny UPDATE - only edge functions with service role should update OTPs
CREATE POLICY "Deny all UPDATE access"
ON public.email_otp
FOR UPDATE
USING (false);

-- Deny DELETE - only edge functions with service role should delete OTPs
CREATE POLICY "Deny all DELETE access"
ON public.email_otp
FOR DELETE
USING (false);