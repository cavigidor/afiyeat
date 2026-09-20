-- User-generated-content safety: reporting, blocking, and a moderation
-- queue. Required for App Store review of any app carrying user content
-- (Guideline 1.2), and independently worth having before strangers can
-- follow each other and see each other's photos and notes.
--
-- Two tables:
--   content_reports - someone flags a user or a piece of content
--   blocked_users   - someone refuses further contact from another user
--
-- Blocking is enforced in the database rather than by filtering in the
-- client, because the client is not a security boundary: a blocked user
-- must not be able to read the blocker's content by calling PostgREST
-- directly, whatever the UI happens to render.

-- ---------------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.blocked_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One row per direction per pair; re-blocking is a no-op rather than a
  -- duplicate, which keeps the "is blocked" check a simple EXISTS.
  CONSTRAINT blocked_users_unique_pair UNIQUE (blocker_id, blocked_id),
  -- Blocking yourself is always a mistake, and would make every
  -- visibility check below exclude the owner from their own content.
  CONSTRAINT blocked_users_no_self_block CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON public.blocked_users (blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON public.blocked_users (blocked_id);

ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

-- Deliberately only the blocker can see their own block list. The blocked
-- party is not told they've been blocked - that's both the platform norm
-- and the safer behaviour, since telling someone tends to escalate.
CREATE POLICY "Users can view their own blocks"
  ON public.blocked_users FOR SELECT
  USING (auth.uid() = blocker_id);

CREATE POLICY "Users can block others"
  ON public.blocked_users FOR INSERT
  WITH CHECK (auth.uid() = blocker_id);

CREATE POLICY "Users can unblock"
  ON public.blocked_users FOR DELETE
  USING (auth.uid() = blocker_id);

-- ---------------------------------------------------------------------
-- Block-aware helper
-- ---------------------------------------------------------------------

-- True when either party has blocked the other. Blocking is treated as
-- mutual for visibility: if A blocks B, neither sees the other. A one-way
-- interpretation would leave the blocker still staring at the content of
-- someone they just told the app they want nothing to do with.
--
-- STABLE + SECURITY DEFINER so it can be called from RLS policies on
-- tables the calling user can't otherwise read, and so the planner can
-- cache it within a statement.
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

-- ---------------------------------------------------------------------
-- Enforce blocks on the social graph
-- ---------------------------------------------------------------------

-- A block should also sever any existing follow relationship in both
-- directions - otherwise the blocked user keeps follower-level access to
-- private content they were granted before the block.
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

-- And prevent a new follow from being created across a block.
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

-- ---------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------

-- Reason and status are text + CHECK rather than enums: adding a value to
-- a Postgres enum can't run inside a transaction with other DDL on some
-- versions, and these lists will change as moderation practice develops.
CREATE TABLE IF NOT EXISTS public.content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Who/what is being reported. reported_user_id is always set (for a
  -- content report it's the content's author), so moderation can see
  -- repeat offenders without joining across every content table.
  reported_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_type TEXT CHECK (
    content_type IS NULL OR content_type IN (
      'user', 'restaurant', 'custom_list', 'custom_list_item',
      'recipe', 'shared_list', 'shared_list_item', 'comment', 'profile_photo'
    )
  ),
  -- Intentionally not a foreign key: it points at one of many tables, and
  -- a report should survive the reported content being deleted (often the
  -- first thing an abusive user does).
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

-- Stops one user spamming the queue with the same complaint. A second
-- report of the same thing by the same person is a duplicate, not new
-- information; reporting it again after it's been actioned/dismissed is
-- allowed, because the situation may genuinely have changed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_reports_one_open_per_target
  ON public.content_reports (reporter_id, reported_user_id, COALESCE(content_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status IN ('pending', 'reviewing');

ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can file reports"
  ON public.content_reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

-- Reporters can see their own reports (so the UI can say "already
-- reported"), but not anyone else's, and not the moderator notes of
-- others. No UPDATE/DELETE policy for users at all: a report is a record
-- of what someone said at a point in time and shouldn't be editable.
-- Moderation runs with the service role, which bypasses RLS.
CREATE POLICY "Users can view their own reports"
  ON public.content_reports FOR SELECT
  USING (auth.uid() = reporter_id);

-- ---------------------------------------------------------------------
-- Enforce blocks on content visibility
-- ---------------------------------------------------------------------

-- These are RESTRICTIVE policies, which AND with the existing permissive
-- ones rather than replacing them. That matters: every table below
-- already has a carefully built owner/public/follower policy set, and
-- rewriting those to add a block check would mean touching working
-- authorization rules on five tables and hoping nothing was missed. A
-- restrictive policy layers on top - whatever the existing rules allow,
-- this additionally requires that the viewer and the owner haven't
-- blocked each other.
--
-- Owners are unaffected: is_blocked_pair(x, x) is false, and the table
-- constraint forbids blocking yourself. Anonymous readers are unaffected
-- too, since auth.uid() is NULL and the EXISTS can't match.

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
