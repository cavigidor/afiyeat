-- device_tokens.token is globally unique specifically so that a new user
-- signing in on a device that previously belonged to someone else reassigns
-- that row via upsert (see the table comment in the original migration),
-- rather than creating a duplicate. But the UPDATE policy's USING clause
-- checked the row's *existing* owner (auth.uid() = user_id) before allowing
-- the update - so if the row already belonged to a different user_id (e.g.
-- a stale row from earlier testing/another account on the same device/
-- simulator), the reassignment silently touched zero rows. No error was
-- raised (RLS just filters the row out of what's updatable), so the client
-- saw a "successful" upsert while the row's user_id never actually changed -
-- explaining "no registered devices found" even though registration
-- appeared to succeed.
--
-- Fix: allow any authenticated user to reach the row for the purposes of
-- reassigning it, but keep WITH CHECK strict so the row can only ever end
-- up owned by the person making the request - nobody can hand a token to
-- some other arbitrary user_id.
DROP POLICY IF EXISTS "Users can update their own device tokens" ON public.device_tokens;

CREATE POLICY "Users can claim or update a device token"
  ON public.device_tokens FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (auth.uid() = user_id);
