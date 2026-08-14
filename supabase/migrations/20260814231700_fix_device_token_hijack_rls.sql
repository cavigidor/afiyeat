-- The July fix for stale-token reassignment (see
-- 20260730155344_fix_device_token_reassignment_rls.sql) changed the
-- device_tokens UPDATE policy's USING clause to `true` so a device that
-- previously belonged to a different account could be reclaimed on
-- upsert. That's broader than intended: USING (true) lets ANY
-- authenticated user update ANY row in the table, not just one whose
-- token they actually possess - e.g. `update().eq('user_id', victim_id)`
-- would succeed for any victim_id discoverable via username search
-- (WITH CHECK only constrains the *resulting* owner, it doesn't limit
-- which existing rows can be touched). Flagged by the security scanner
-- as a token-hijack vector.
--
-- Fix: move the claim/upsert into a SECURITY DEFINER function that only
-- ever trusts auth.uid() (never a client-supplied user_id) and matches
-- the row by the token value itself - which only the legitimate device
-- actually knows, since it comes from Apple/Google's push registration,
-- not something guessable via a public profile lookup. The table's own
-- UPDATE policy goes back to strictly owner-only.

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
