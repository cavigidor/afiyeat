-- Completes the UGC safety system: someone has to be able to act on the
-- reports the previous migration started collecting.
--
-- App Review wants evidence that reports go somewhere, not just that a
-- Report button exists. This adds the role that lets a trusted account
-- work the queue, without building a separate admin application.

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------

-- Roles live in their own table rather than as a column on profiles.
-- A boolean on a user-editable row is a privilege-escalation waiting to
-- happen: profiles is updatable by its owner, so an is_moderator column
-- there could be set by the user it describes. This table has no user
-- INSERT/UPDATE policy at all - membership is granted out of band with
-- the service role.
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('moderator', 'admin')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_roles_unique UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Users may see their own roles (so the app can show or hide the queue),
-- and nothing else. No INSERT/UPDATE/DELETE policies: granting a role is
-- deliberately impossible from the client under any circumstances.
CREATE POLICY "Users can see their own roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

-- SECURITY DEFINER so policies can call it without the caller needing
-- read access to user_roles for other people.
CREATE OR REPLACE FUNCTION public.has_role(check_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = check_role
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_role(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.has_role(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- Moderator access to the report queue
-- ---------------------------------------------------------------------

-- Moderators can read every report and record a decision on it. Note the
-- absence of a DELETE policy: reports are not removable, only resolved,
-- so the moderation record stays auditable.
CREATE POLICY "Moderators can view all reports"
  ON public.content_reports FOR SELECT
  USING (public.has_role('moderator') OR public.has_role('admin'));

CREATE POLICY "Moderators can resolve reports"
  ON public.content_reports FOR UPDATE
  USING (public.has_role('moderator') OR public.has_role('admin'))
  WITH CHECK (public.has_role('moderator') OR public.has_role('admin'));

-- Convenience view for working the queue: the report plus who filed it
-- and who it's about. Defined with security_invoker so it inherits the
-- caller's RLS rather than running as the definer - without that, a view
-- over content_reports would leak the whole queue to any authenticated
-- user regardless of the policies above.
CREATE OR REPLACE VIEW public.moderation_queue
WITH (security_invoker = true)
AS
SELECT
  r.id,
  r.created_at,
  r.status,
  r.reason,
  r.description,
  r.content_type,
  r.content_id,
  r.moderator_notes,
  r.reviewed_at,
  r.reporter_id,
  reporter.username  AS reporter_username,
  r.reported_user_id,
  reported.username  AS reported_username,
  reported.display_name AS reported_display_name,
  -- How many open reports this account has attracted overall: one report
  -- is noise, a pattern is signal, and that's the difference a moderator
  -- most needs to see at a glance.
  (
    SELECT count(*) FROM public.content_reports r2
    WHERE r2.reported_user_id = r.reported_user_id
  ) AS total_reports_against_user
FROM public.content_reports r
LEFT JOIN public.profiles reporter ON reporter.user_id = r.reporter_id
LEFT JOIN public.profiles reported ON reported.user_id = r.reported_user_id;

GRANT SELECT ON public.moderation_queue TO authenticated;

-- ---------------------------------------------------------------------
-- NOTE FOR OPERATORS
-- ---------------------------------------------------------------------
-- To grant yourself moderator access, run this once with the service role
-- (Lovable's SQL editor), replacing the email:
--
--   INSERT INTO public.user_roles (user_id, role)
--   SELECT id, 'admin' FROM auth.users WHERE email = 'you@example.com'
--   ON CONFLICT DO NOTHING;
--
-- Until at least one such row exists, the queue is readable by nobody,
-- which is the correct default.
