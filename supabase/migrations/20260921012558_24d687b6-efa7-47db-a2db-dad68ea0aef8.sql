CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('moderator', 'admin')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_roles_unique UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see their own roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

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

CREATE POLICY "Moderators can view all reports"
  ON public.content_reports FOR SELECT
  USING (public.has_role('moderator') OR public.has_role('admin'));

CREATE POLICY "Moderators can resolve reports"
  ON public.content_reports FOR UPDATE
  USING (public.has_role('moderator') OR public.has_role('admin'))
  WITH CHECK (public.has_role('moderator') OR public.has_role('admin'));

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
  reporter.username AS reporter_username,
  r.reported_user_id,
  reported.username AS reported_username,
  reported.display_name AS reported_display_name,
  (
    SELECT count(*) FROM public.content_reports r2
    WHERE r2.reported_user_id = r.reported_user_id
  ) AS total_reports_against_user
FROM public.content_reports r
LEFT JOIN public.profiles reporter ON reporter.user_id = r.reporter_id
LEFT JOIN public.profiles reported ON reported.user_id = r.reported_user_id;

GRANT SELECT ON public.moderation_queue TO authenticated;