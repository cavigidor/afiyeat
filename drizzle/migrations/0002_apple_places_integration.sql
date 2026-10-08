-- Apple Places integration: new tables, columns and functions only

-- Track which places came from Apple Maps
ALTER TABLE public.restaurants ADD COLUMN apple_place_id TEXT;
ALTER TABLE public.custom_list_items ADD COLUMN apple_place_id TEXT;
ALTER TABLE public.shared_list_items ADD COLUMN apple_place_id TEXT;

CREATE INDEX idx_restaurants_apple_place_id ON public.restaurants (apple_place_id) WHERE apple_place_id IS NOT NULL;
CREATE INDEX idx_custom_list_items_apple_place_id ON public.custom_list_items (apple_place_id) WHERE apple_place_id IS NOT NULL;
CREATE INDEX idx_shared_list_items_apple_place_id ON public.shared_list_items (apple_place_id) WHERE apple_place_id IS NOT NULL;

-- Cache of Apple place details to avoid re-fetching
CREATE TABLE public.apple_place_cache (
  apple_place_id TEXT PRIMARY KEY,
  name TEXT,
  formatted_address TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  phone TEXT,
  website TEXT,
  categories TEXT[],
  raw JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.apple_place_cache TO authenticated;
GRANT ALL ON public.apple_place_cache TO service_role;

ALTER TABLE public.apple_place_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read apple place cache"
ON public.apple_place_cache FOR SELECT TO authenticated USING (true);

-- Per-user daily limit for Apple Maps lookups
CREATE TABLE public.apple_maps_usage (
  user_id UUID NOT NULL,
  day DATE NOT NULL,
  count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

GRANT ALL ON public.apple_maps_usage TO service_role;

ALTER TABLE public.apple_maps_usage ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.apple_maps_try_consume(p_user_id UUID, p_limit INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  INSERT INTO public.apple_maps_usage (user_id, day, count)
  VALUES (p_user_id, CURRENT_DATE, 0)
  ON CONFLICT (user_id, day) DO NOTHING;

  SELECT count INTO v_count
  FROM public.apple_maps_usage
  WHERE user_id = p_user_id AND day = CURRENT_DATE
  FOR UPDATE;

  IF v_count >= p_limit THEN
    RETURN FALSE;
  END IF;

  UPDATE public.apple_maps_usage
  SET count = count + 1
  WHERE user_id = p_user_id AND day = CURRENT_DATE;

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apple_maps_try_consume(UUID, INT) FROM public;
REVOKE EXECUTE ON FUNCTION public.apple_maps_try_consume(UUID, INT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.apple_maps_try_consume(UUID, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apple_maps_try_consume(UUID, INT) TO service_role;

-- Check whether any of the given Apple place ids are already saved anywhere
CREATE OR REPLACE FUNCTION public.apple_place_is_referenced(p_ids TEXT[])
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(ref_id), ARRAY[]::TEXT[])
  FROM (
    SELECT DISTINCT ref_id FROM unnest(p_ids) AS ref(ref_id)
    WHERE EXISTS (SELECT 1 FROM public.restaurants r WHERE r.apple_place_id = ref.ref_id)
       OR EXISTS (SELECT 1 FROM public.custom_list_items c WHERE c.apple_place_id = ref.ref_id)
       OR EXISTS (SELECT 1 FROM public.shared_list_items s WHERE s.apple_place_id = ref.ref_id)
  ) sub;
$$;

REVOKE EXECUTE ON FUNCTION public.apple_place_is_referenced(TEXT[]) FROM public;
REVOKE EXECUTE ON FUNCTION public.apple_place_is_referenced(TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.apple_place_is_referenced(TEXT[]) TO authenticated;