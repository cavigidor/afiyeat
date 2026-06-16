-- 1. Harden the follows UPDATE policy: only the target user can update, status
-- limited to valid values, and identity columns cannot be changed.
DROP POLICY IF EXISTS "Users can update follows" ON public.follows;
CREATE POLICY "Users can update follows"
ON public.follows
FOR UPDATE
TO authenticated
USING (auth.uid() = following_id)
WITH CHECK (
  auth.uid() = following_id
  AND status IN ('pending', 'accepted', 'rejected')
);

-- Prevent changing follower_id / following_id on update (RLS WITH CHECK cannot see OLD).
CREATE OR REPLACE FUNCTION public.prevent_follow_identity_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.follower_id <> OLD.follower_id OR NEW.following_id <> OLD.following_id THEN
    RAISE EXCEPTION 'Cannot change follower_id or following_id';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_follow_identity_change_trigger ON public.follows;
CREATE TRIGGER prevent_follow_identity_change_trigger
BEFORE UPDATE ON public.follows
FOR EACH ROW
EXECUTE FUNCTION public.prevent_follow_identity_change();

-- 2. Restrict public recipe reads to authenticated users only.
DROP POLICY IF EXISTS "Users can view public recipes" ON public.recipes;
CREATE POLICY "Users can view public recipes"
ON public.recipes
FOR SELECT
TO authenticated
USING (is_public = true);

-- 3. Revoke direct EXECUTE on SECURITY DEFINER functions that should only run
-- internally (triggers) or never directly by clients.
REVOKE EXECUTE ON FUNCTION public.enforce_follow_status() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.prevent_follow_identity_change() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.can_view_profile(uuid) FROM anon, authenticated, public;

-- is_shared_list_member is used inside RLS policies for authenticated users, so it
-- must remain executable by authenticated, but anon never needs it.
REVOKE EXECUTE ON FUNCTION public.is_shared_list_member(uuid, uuid) FROM anon, public;