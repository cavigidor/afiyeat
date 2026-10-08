-- Apple Maps foundation: permanent place IDs, short-lived place details.
--
-- Apple's terms let an app keep a place's Apple Place ID permanently, but
-- treat everything else Apple returns about a place (name, address,
-- coordinates, category) as Map Data that may only be kept temporarily to
-- make the service faster. So:
--
--   * Saved items get an apple_place_id column - the permanent reference.
--   * place_cache holds Apple's details for a limited time (expires_at),
--     filled on demand by the apple-maps edge function and purged daily.
--     Nothing outside the edge function writes to it.
--   * The user's own content (their label for the place, notes, rating,
--     status, photos) stays on the item as before.
--
-- Additive only: existing columns and rows are untouched, so current app
-- builds keep working while the app moves over.

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

-- Anyone may read details that haven't expired (signed-out share previews
-- show place names too). Expired rows are invisible even before the daily
-- purge removes them. There is no INSERT/UPDATE/DELETE policy: only the
-- service role (the apple-maps edge function) writes here.
DROP POLICY IF EXISTS "Unexpired place details are readable" ON public.place_cache;
CREATE POLICY "Unexpired place details are readable"
  ON public.place_cache FOR SELECT
  TO anon, authenticated
  USING (expires_at > now());

REVOKE INSERT, UPDATE, DELETE ON public.place_cache FROM anon, authenticated;
GRANT SELECT ON public.place_cache TO anon, authenticated;

-- Permanent Apple references on every table that stores a place.
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS apple_place_id TEXT;
ALTER TABLE public.custom_list_items ADD COLUMN IF NOT EXISTS apple_place_id TEXT;
ALTER TABLE public.shared_list_items ADD COLUMN IF NOT EXISTS apple_place_id TEXT;

CREATE INDEX IF NOT EXISTS idx_restaurants_apple_place_id
  ON public.restaurants (apple_place_id) WHERE apple_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_custom_list_items_apple_place_id
  ON public.custom_list_items (apple_place_id) WHERE apple_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shared_list_items_apple_place_id
  ON public.shared_list_items (apple_place_id) WHERE apple_place_id IS NOT NULL;

-- True if any saved item anywhere refers to this Apple place. The edge
-- function only fetches details for referenced places, so the endpoint
-- can't be used to look up arbitrary IDs on Afiyeat's quota.
CREATE OR REPLACE FUNCTION public.apple_place_is_referenced(p_ids TEXT[])
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

-- Daily count of Apple Maps calls made by the edge function, so usage can
-- be watched against Apple's free daily quota (25,000 calls shared with
-- MapKit JS) and the function can stop short of it.
CREATE TABLE IF NOT EXISTS public.apple_maps_usage (
  day DATE PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE public.apple_maps_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.apple_maps_usage FROM anon, authenticated;

-- Atomically adds p_calls to today's count if that stays within p_cap.
-- Returns false (and adds nothing) when it wouldn't.
CREATE OR REPLACE FUNCTION public.apple_maps_try_spend(p_calls INTEGER, p_cap INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH upsert AS (
    INSERT INTO public.apple_maps_usage AS u (day, calls)
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

-- Purge expired place details once a day.
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
