-- Change default so follows start as pending requests
ALTER TABLE public.follows ALTER COLUMN status SET DEFAULT 'pending';

-- Trigger function: force correct status based on target's privacy.
-- Public target -> accepted; private target -> pending. Client-provided status is ignored.
CREATE OR REPLACE FUNCTION public.enforce_follow_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_private boolean;
BEGIN
  SELECT is_private INTO target_private
  FROM public.profiles
  WHERE user_id = NEW.following_id;

  IF target_private IS TRUE THEN
    NEW.status := 'pending';
  ELSE
    NEW.status := 'accepted';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_follow_status_trigger ON public.follows;
CREATE TRIGGER enforce_follow_status_trigger
BEFORE INSERT ON public.follows
FOR EACH ROW
EXECUTE FUNCTION public.enforce_follow_status();

-- Tighten INSERT policy: a user may only create follow rows as themselves.
DROP POLICY IF EXISTS "Users can follow others" ON public.follows;
CREATE POLICY "Users can follow others"
ON public.follows
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = follower_id);

-- Reset any existing follow rows that targeted private accounts but were auto-accepted
-- without the target's approval (close the existing exposure).
UPDATE public.follows f
SET status = 'pending'
FROM public.profiles p
WHERE f.following_id = p.user_id
  AND p.is_private = true
  AND f.status = 'accepted';