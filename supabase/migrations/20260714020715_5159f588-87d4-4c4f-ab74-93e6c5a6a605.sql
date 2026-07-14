-- Scheduled pushes: a weekly digest for everyone with a registered device,
-- and a per-user "haven't added a place in a while" nudge (capped to once
-- every 7 days per user so it can't spam).

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS public.engagement_reminders (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_sent_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.engagement_reminders TO service_role;
ALTER TABLE public.engagement_reminders ENABLE ROW LEVEL SECURITY;
-- Internal bookkeeping only - no policies, so anon/authenticated get zero
-- access regardless. Only the SECURITY DEFINER function below touches it.

CREATE OR REPLACE FUNCTION public.send_weekly_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT user_id FROM public.device_tokens LOOP
    PERFORM public.notify_user(
      r.user_id,
      'Your weekly Afiyeat digest',
      'New food news, recommendations, and friend activity are waiting for you.',
      jsonb_build_object('type', 'weekly_digest')
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_inactivity_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT dt.user_id
    FROM (SELECT DISTINCT user_id FROM public.device_tokens) dt
    LEFT JOIN (
      SELECT user_id, MAX(created_at) AS last_added
      FROM public.restaurants
      GROUP BY user_id
    ) ra ON ra.user_id = dt.user_id
    LEFT JOIN public.engagement_reminders er ON er.user_id = dt.user_id
    WHERE COALESCE(ra.last_added, '1970-01-01'::timestamptz) < now() - interval '7 days'
      AND (er.last_sent_at IS NULL OR er.last_sent_at < now() - interval '7 days')
  LOOP
    PERFORM public.notify_user(
      r.user_id,
      'Haven''t added a place in a while?',
      'Tap to log a new restaurant, bar, or recipe you tried recently.',
      jsonb_build_object('type', 'inactivity_reminder')
    );

    INSERT INTO public.engagement_reminders (user_id, last_sent_at)
    VALUES (r.user_id, now())
    ON CONFLICT (user_id) DO UPDATE SET last_sent_at = now();
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_weekly_digest() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.send_inactivity_reminders() FROM anon, authenticated, public;

-- Weekly digest: Mondays 4pm UTC.
SELECT cron.schedule(
  'weekly-digest',
  '0 16 * * 1',
  $$ SELECT public.send_weekly_digest(); $$
);

-- Inactivity nudge: checked daily at 5pm UTC; the 7-day cooldown inside the
-- function itself is what actually prevents spam, not the schedule.
SELECT cron.schedule(
  'inactivity-reminders',
  '0 17 * * *',
  $$ SELECT public.send_inactivity_reminders(); $$
);
