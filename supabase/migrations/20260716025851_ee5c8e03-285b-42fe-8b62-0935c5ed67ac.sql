ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS place_id text;
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS category text;

CREATE INDEX IF NOT EXISTS restaurants_place_id_idx ON public.restaurants(place_id) WHERE place_id IS NOT NULL;

DROP POLICY IF EXISTS "Users can view restaurants of public profiles" ON public.restaurants;
CREATE POLICY "Users can view restaurants of public profiles"
ON public.restaurants FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = restaurants.user_id AND p.is_private = false
  )
);

CREATE OR REPLACE FUNCTION public.get_explore_places(p_mode text DEFAULT 'all')
RETURNS TABLE (
  place_id text,
  name text,
  address text,
  latitude double precision,
  longitude double precision,
  category text,
  price_level integer,
  avg_rating numeric,
  rating_count bigint,
  contributor_count bigint
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
    AVG(r.rating) FILTER (WHERE r.rating IS NOT NULL),
    COUNT(r.rating) FILTER (WHERE r.rating IS NOT NULL),
    COUNT(DISTINCT r.user_id)
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

CREATE OR REPLACE FUNCTION public.get_place_comments(p_place_id text, p_mode text DEFAULT 'all')
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  rating integer,
  notes text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    r.rating,
    r.notes,
    r.created_at
  FROM public.restaurants r
  JOIN public.profiles p ON p.user_id = r.user_id
  WHERE r.place_id = p_place_id
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
  ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_place_comments(text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_place_comments(text, text) TO authenticated;