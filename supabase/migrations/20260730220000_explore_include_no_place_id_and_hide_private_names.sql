-- Two Explore bugs reported together:
--
-- 1. "Only restaurants added today show up, nothing older." Root cause:
--    get_explore_places required r.place_id IS NOT NULL. The place_id
--    column (and the code that captures it from Mapbox search) was added
--    recently - every restaurant added before that point has a real
--    address/lat/lng (they were always added via the same search flow),
--    but no place_id, since the column didn't exist yet when they were
--    inserted. Switch the requirement from "has a place_id" to "has an
--    address", which every restaurant (old or new) actually has, and fall
--    back to a name+address based grouping key for rows that lack a real
--    place_id so they can still be de-duplicated/merged across accounts
--    the same way place_id-based rows are.
--
-- 2. "Remove the privacy requirement - if the account is private, just
--    don't show the username; if public, show it." Previously, a private
--    account's "went_to" restaurants were excluded entirely from "All
--    Nearby". Now they're included like anyone else's, but
--    get_place_comments nulls out the username/display_name/avatar_url
--    for a private contributor (unless you're looking at your own),
--    so the place still shows up with its rating/photos/notes, just
--    without identifying who added it.

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
