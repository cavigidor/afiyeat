-- Bug fix: PostgREST serializes `numeric` and `bigint` columns as JSON
-- *strings* (not numbers) to avoid precision loss - a well-known Supabase
-- gotcha. get_explore_places returned AVG(...) as `numeric` and the two
-- COUNT(...) as `bigint`, so avg_rating/rating_count/contributor_count
-- arrived client-side as strings like "7.5" instead of 7.5. The client
-- calls `place.avg_rating.toFixed(1)`, which throws on a string and crashes
-- the Explore map/list/detail-sheet rendering for any place that actually
-- has ratings.
--
-- Fix: cast to double precision / integer, which PostgREST serializes as
-- real JSON numbers.
CREATE OR REPLACE FUNCTION public.get_explore_places(p_mode text DEFAULT 'all')
RETURNS TABLE (
  place_id text,
  name text,
  address text,
  latitude double precision,
  longitude double precision,
  category text,
  price_level integer,
  avg_rating double precision,
  rating_count integer,
  contributor_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.place_id,
    (array_agg(r.name ORDER BY r.created_at DESC))[1],
    (array_agg(r.address ORDER BY r.created_at DESC))[1],
    (array_agg(r.latitude ORDER BY r.created_at DESC))[1],
    (array_agg(r.longitude ORDER BY r.created_at DESC))[1],
    (array_agg(r.category ORDER BY r.created_at DESC) FILTER (WHERE r.category IS NOT NULL))[1],
    (array_agg(r.price_level ORDER BY r.created_at DESC) FILTER (WHERE r.price_level IS NOT NULL))[1],
    (AVG(r.rating) FILTER (WHERE r.rating IS NOT NULL))::double precision,
    (COUNT(r.rating) FILTER (WHERE r.rating IS NOT NULL))::integer,
    (COUNT(DISTINCT r.user_id))::integer
  FROM public.restaurants r
  JOIN public.profiles p ON p.user_id = r.user_id
  WHERE r.place_id IS NOT NULL
    AND r.status = 'went_to'
    AND (
      r.user_id = auth.uid()
      OR (
        p_mode = 'friends'
        AND EXISTS (
          SELECT 1 FROM public.follows f
          WHERE f.follower_id = auth.uid()
            AND f.following_id = r.user_id
            AND f.status = 'accepted'
        )
      )
      OR (p_mode = 'all' AND p.is_private = false)
    )
  GROUP BY r.place_id;
$$;

REVOKE ALL ON FUNCTION public.get_explore_places(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_explore_places(text) TO authenticated;
