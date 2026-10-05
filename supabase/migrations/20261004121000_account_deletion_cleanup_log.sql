-- Durable record of anything account deletion couldn't finish.
--
-- delete-account removes the auth user first (which cascades through
-- almost every table), then cleans up what isn't covered by a cascade:
-- rows with no foreign key back to auth.users, and image files in
-- storage. If any of that follow-up work fails, the account itself is
-- already gone, so the user can't simply retry. Each failed step is
-- written here instead, so it can be finished by hand or by a later job
-- rather than silently leaving data behind.
--
-- No client access at all: RLS is on with no policies, so only the
-- service role (edge functions) can read or write it.

CREATE TABLE IF NOT EXISTS public.account_deletion_cleanup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_user_id UUID NOT NULL,
  step TEXT NOT NULL,
  detail TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_cleanup_open
  ON public.account_deletion_cleanup (created_at)
  WHERE resolved_at IS NULL;

ALTER TABLE public.account_deletion_cleanup ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.account_deletion_cleanup FROM anon, authenticated;
