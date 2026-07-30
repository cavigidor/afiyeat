DROP POLICY IF EXISTS "Users can update their own device tokens" ON public.device_tokens;

CREATE POLICY "Users can claim or update a device token"
  ON public.device_tokens FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (auth.uid() = user_id);