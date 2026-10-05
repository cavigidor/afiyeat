-- Per-user daily limit for AI photo scanning (parse-recipe-image, and the
-- planned "Scan anything").
--
-- Each scan is a paid AI request. Until now the function accepted any
-- caller holding the app's public key, with no cap, so anyone could run
-- up the AI bill. The function now requires a signed-in user and calls
-- ai_scan_try_consume first; this table holds one counter per user per
-- UTC day.
--
-- Service role only: RLS is on with no policies, and the function is not
-- executable by app users directly.

CREATE TABLE IF NOT EXISTS public.ai_scan_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  scans INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

ALTER TABLE public.ai_scan_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_scan_usage FROM anon, authenticated;

-- Atomically counts one scan for today if the user is under p_daily_limit.
-- Returns true if the scan may go ahead. A single INSERT ... ON CONFLICT
-- with a guarded UPDATE, so simultaneous scans can't both squeeze past
-- the limit.
CREATE OR REPLACE FUNCTION public.ai_scan_try_consume(p_user_id UUID, p_daily_limit INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH upsert AS (
    INSERT INTO public.ai_scan_usage AS u (user_id, day, scans)
    VALUES (p_user_id, (now() AT TIME ZONE 'utc')::date, 1)
    ON CONFLICT (user_id, day) DO UPDATE
      SET scans = u.scans + 1
      WHERE u.scans < p_daily_limit
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM upsert);
$$;

REVOKE ALL ON FUNCTION public.ai_scan_try_consume(UUID, INTEGER) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_scan_try_consume(UUID, INTEGER) TO service_role;
