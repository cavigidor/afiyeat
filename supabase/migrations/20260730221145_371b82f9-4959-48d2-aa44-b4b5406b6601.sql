DROP FUNCTION IF EXISTS public.get_explore_places(text);
DROP FUNCTION IF EXISTS public.get_place_comments(text, text);

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
    COALESCE(
      NULLIF(btrim(r.place_id), ''),
      'nm:' || md5(lower(btrim(r.name)) || '|' || lower(btrim(COALESCE(r.address, ''))))
    ) AS place_id,
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
  WHERE r.status = 'went_to'
    AND r.address IS NOT NULL
    AND btrim(r.address) <> ''
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
      OR p_mode = 'all'
    )
  GROUP BY 1;
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
  created_at timestamptz,
  is_anonymous boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.user_id,
    CASE WHEN p.is_private AND r.user_id <> auth.uid() THEN NULL ELSE p.username END,
    CASE WHEN p.is_private AND r.user_id <> auth.uid() THEN NULL ELSE p.display_name END,
    CASE WHEN p.is_private AND r.user_id <> auth.uid() THEN NULL ELSE p.avatar_url END,
    r.rating,
    r.notes,
    r.created_at,
    (p.is_private AND r.user_id <> auth.uid()) AS is_anonymous
  FROM public.restaurants r
  JOIN public.profiles p ON p.user_id = r.user_id
  WHERE r.status = 'went_to'
    AND r.address IS NOT NULL
    AND btrim(r.address) <> ''
    AND COALESCE(
      NULLIF(btrim(r.place_id), ''),
      'nm:' || md5(lower(btrim(r.name)) || '|' || lower(btrim(COALESCE(r.address, ''))))
    ) = p_place_id
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
      OR p_mode = 'all'
    )
  ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_place_comments(text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_place_comments(text, text) TO authenticated;