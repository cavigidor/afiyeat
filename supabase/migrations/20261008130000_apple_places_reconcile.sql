-- Reconcile the Apple Maps foundation with what the apple-maps edge
-- function expects.
--
-- 20261008120000_apple_places_foundation was applied in a rewritten form
-- (as drizzle 0002_apple_places_integration): it created apple_place_cache
-- with no expiry, a per-user apple_maps_usage table and
-- apple_maps_try_consume, and an apple_place_is_referenced that returns
-- TEXT[] and is callable by every signed-in user. None of that is used by
-- the edge function, and the cache without expiry doesn't meet Apple's
-- "temporary storage only" rule for place details.
--
-- This migration is written to work against that state (and against a
-- clean database), and leaves exactly one design in place:
--   * place_cache          - details with expires_at, readable only while
--                            unexpired, written only by the service role
--   * apple_maps_daily_calls + apple_maps_try_spend - global daily cap
--   * apple_place_is_referenced(TEXT[]) RETURNS TABLE - service role only
--   * purge_expired_place_cache + a daily cron job
--
-- The objects removed below were created today, are empty and are not
-- referenced by any code: the edge function has never written to them.

-- 1. Remove the unused objects from the rewritten version.
DROP FUNCTION IF EXISTS public.apple_maps_try_consume(UUID, INT);
DROP TABLE IF EXISTS public.apple_maps_usage;
DROP TABLE IF EXISTS public.apple_place_cache;
-- Return type is changing (TEXT[] -> TABLE), which needs a drop first.
DROP FUNCTION IF EXISTS public.apple_place_is_referenced(TEXT[]);

-- 2. Permanent Apple references (already present; kept idempotent).
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS apple_place_id TEXT;
ALTER TABLE public.custom_list_items ADD COLUMN IF NOT EXISTS apple_place_id TEXT;
ALTER TABLE public.shared_list_items ADD COLUMN IF NOT EXISTS apple_place_id TEXT;

CREATE INDEX IF NOT EXISTS idx_restaurants_apple_place_id
  ON public.restaurants (apple_place_id) WHERE apple_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_custom_list_items_apple_place_id
  ON public.custom_list_items (apple_place_id) WHERE apple_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shared_list_items_apple_place_id
  ON public.shared_list_items (apple_place_id) WHERE apple_place_id IS NOT NULL;

-- 3. Short-lived place details.
CREATE TABLE IF NOT EXISTS public.place_cache (
  apple_place_id TEXT PRIMARY KEY,
  name TEXT,
  address TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  category TEXT,
  country_code TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_place_cache_expires ON public.place_cache (expires_at);

ALTER TABLE public.place_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Unexpired place details are readable" ON public.place_cache;
CREATE POLICY "Unexpired place details are readable"
  ON public.place_cache FOR SELECT
  TO anon, authenticated
  USING (expires_at > now());

REVOKE INSERT, UPDATE, DELETE ON public.place_cache FROM anon, authenticated;
GRANT SELECT ON public.place_cache TO anon, authenticated;
GRANT ALL ON public.place_cache TO service_role;

-- 4. Which of these Apple IDs has anyone saved? Service role only: it
--    would otherwise tell any user whether a given place is in someone's
--    list.
CREATE FUNCTION public.apple_place_is_referenced(p_ids TEXT[])
RETURNS TABLE (apple_place_id TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ref.ref_id FROM unnest(p_ids) AS ref(ref_id)
  WHERE EXISTS (SELECT 1 FROM public.restaurants r WHERE r.apple_place_id = ref.ref_id)
     OR EXISTS (SELECT 1 FROM public.custom_list_items c WHERE c.apple_place_id = ref.ref_id)
     OR EXISTS (SELECT 1 FROM public.shared_list_items s WHERE s.apple_place_id = ref.ref_id);
$$;

REVOKE ALL ON FUNCTION public.apple_place_is_referenced(TEXT[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apple_place_is_referenced(TEXT[]) TO service_role;

-- 5. Global daily call counter, kept under Apple's free quota.
CREATE TABLE IF NOT EXISTS public.apple_maps_daily_calls (
  day DATE PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE public.apple_maps_daily_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.apple_maps_daily_calls FROM anon, authenticated;
GRANT ALL ON public.apple_maps_daily_calls TO service_role;

CREATE OR REPLACE FUNCTION public.apple_maps_try_spend(p_calls INTEGER, p_cap INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH upsert AS (
    INSERT INTO public.apple_maps_daily_calls AS u (day, calls)
    VALUES ((now() AT TIME ZONE 'utc')::date, p_calls)
    ON CONFLICT (day) DO UPDATE
      SET calls = u.calls + p_calls
      WHERE u.calls + p_calls <= p_cap
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM upsert);
$$;

REVOKE ALL ON FUNCTION public.apple_maps_try_spend(INTEGER, INTEGER) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apple_maps_try_spend(INTEGER, INTEGER) TO service_role;

-- 6. Daily purge of expired details.
CREATE OR REPLACE FUNCTION public.purge_expired_place_cache()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.place_cache WHERE expires_at <= now();
$$;

REVOKE ALL ON FUNCTION public.purge_expired_place_cache() FROM public, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-expired-place-cache') THEN
    PERFORM cron.unschedule('purge-expired-place-cache');
  END IF;
  PERFORM cron.schedule(
    'purge-expired-place-cache',
    '17 4 * * *',
    'select public.purge_expired_place_cache();'
  );
END;
$$;
