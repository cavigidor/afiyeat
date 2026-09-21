CREATE TABLE IF NOT EXISTS public.blocked_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT blocked_users_unique_pair UNIQUE (blocker_id, blocked_id),
  CONSTRAINT blocked_users_no_self_block CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON public.blocked_users (blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON public.blocked_users (blocked_id);

ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own blocks"
  ON public.blocked_users FOR SELECT
  USING (auth.uid() = blocker_id);

CREATE POLICY "Users can block others"
  ON public.blocked_users FOR INSERT
  WITH CHECK (auth.uid() = blocker_id);

CREATE POLICY "Users can unblock"
  ON public.blocked_users FOR DELETE
  USING (auth.uid() = blocker_id);

CREATE OR REPLACE FUNCTION public.is_blocked_pair(a UUID, b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocked_users
    WHERE (blocker_id = a AND blocked_id = b)
       OR (blocker_id = b AND blocked_id = a)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_blocked_pair(UUID, UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.is_blocked_pair(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.sever_follows_on_block()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.follows
  WHERE (follower_id = NEW.blocker_id AND following_id = NEW.blocked_id)
     OR (follower_id = NEW.blocked_id AND following_id = NEW.blocker_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sever_follows_on_block_trigger ON public.blocked_users;
CREATE TRIGGER sever_follows_on_block_trigger
AFTER INSERT ON public.blocked_users
FOR EACH ROW
EXECUTE FUNCTION public.sever_follows_on_block();

CREATE OR REPLACE FUNCTION public.prevent_follow_when_blocked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_blocked_pair(NEW.follower_id, NEW.following_id) THEN
    RAISE EXCEPTION 'Cannot follow: one of these users has blocked the other'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_follow_when_blocked_trigger ON public.follows;
CREATE TRIGGER prevent_follow_when_blocked_trigger
BEFORE INSERT ON public.follows
FOR EACH ROW
EXECUTE FUNCTION public.prevent_follow_when_blocked();

CREATE TABLE IF NOT EXISTS public.content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_type TEXT CHECK (
    content_type IS NULL OR content_type IN (
      'user', 'restaurant', 'custom_list', 'custom_list_item',
      'recipe', 'shared_list', 'shared_list_item', 'comment', 'profile_photo'
    )
  ),
  content_id UUID,
  reason TEXT NOT NULL CHECK (reason IN (
    'spam', 'harassment', 'hate', 'sexual', 'dangerous', 'copyright', 'other'
  )),
  description TEXT CHECK (description IS NULL OR length(description) <= 2000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'reviewing', 'actioned', 'dismissed'
  )),
  moderator_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT content_reports_no_self_report CHECK (reporter_id <> reported_user_id)
);

CREATE INDEX IF NOT EXISTS idx_content_reports_status ON public.content_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_reports_reported_user ON public.content_reports (reported_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_reports_one_open_per_target
  ON public.content_reports (reporter_id, reported_user_id, COALESCE(content_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status IN ('pending', 'reviewing');

ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can file reports"
  ON public.content_reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY "Users can view their own reports"
  ON public.content_reports FOR SELECT
  USING (auth.uid() = reporter_id);

CREATE POLICY "Blocked users cannot view profiles"
  ON public.profiles AS RESTRICTIVE FOR SELECT
  USING (auth.uid() IS NULL OR NOT public.is_blocked_pair(auth.uid(), user_id));

CREATE POLICY "Blocked users cannot view restaurants"
  ON public.restaurants AS RESTRICTIVE FOR SELECT
  USING (auth.uid() IS NULL OR NOT public.is_blocked_pair(auth.uid(), user_id));

CREATE POLICY "Blocked users cannot view custom lists"
  ON public.custom_lists AS RESTRICTIVE FOR SELECT
  USING (auth.uid() IS NULL OR NOT public.is_blocked_pair(auth.uid(), user_id));

CREATE POLICY "Blocked users cannot view custom list items"
  ON public.custom_list_items AS RESTRICTIVE FOR SELECT
  USING (auth.uid() IS NULL OR NOT public.is_blocked_pair(auth.uid(), user_id));

CREATE POLICY "Blocked users cannot view recipes"
  ON public.recipes AS RESTRICTIVE FOR SELECT
  USING (auth.uid() IS NULL OR NOT public.is_blocked_pair(auth.uid(), user_id));