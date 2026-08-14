CREATE OR REPLACE FUNCTION public.claim_device_token(p_token text, p_platform text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.device_tokens (user_id, token, platform)
  VALUES (auth.uid(), p_token, p_platform)
  ON CONFLICT (token) DO UPDATE
    SET user_id = auth.uid(), platform = p_platform, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.claim_device_token(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_device_token(text, text) TO authenticated;

DROP POLICY IF EXISTS "Users can claim or update a device token" ON public.device_tokens;

CREATE POLICY "Users can update their own device tokens"
  ON public.device_tokens FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);