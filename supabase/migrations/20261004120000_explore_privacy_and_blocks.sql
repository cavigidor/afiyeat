-- Explore: respect blocks and private profiles inside the SECURITY DEFINER
-- discovery functions.
--
-- These three functions run as their owner, so the RLS on restaurants /
-- custom_lists (including the restrictive "blocked users cannot view ..."
-- policies) does not apply inside them. Each one therefore has to apply
-- the same rules itself:
--
--   * Blocks: rows owned by someone the viewer has blocked, or who has
--     blocked the viewer, are left out entirely - in aggregates too.
--   * Private profiles: a private user's identity, user id and written
--     notes are only returned to themselves and to accepted followers.
--     Previously the name was hidden but the user id (enough to open the
--     profile) and the notes were still returned to everyone.
--   * Private users' lists are no longer listed at all for people who
--     can't open them; the list name itself can be personal.
--
-- Signatures and return columns are unchanged, so existing app builds
-- keep working. For anonymous comment rows user_id is now NULL.

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
  WHERE auth.uid() IS NOT NULL
    AND r.status = 'went_to'
    AND r.address IS NOT NULL
    AND btrim(r.address) <> ''
    AND NOT public.is_blocked_pair(auth.uid(), r.user_id)
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
  avatar_emoji text,
  avatar_color text,
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
    CASE WHEN v.can_see THEN r.user_id END,
    CASE WHEN v.can_see THEN p.username END,
    CASE WHEN v.can_see THEN p.display_name END,
    CASE WHEN v.can_see THEN p.avatar_emoji END,
    CASE WHEN v.can_see THEN p.avatar_color END,
    r.rating,
    CASE WHEN v.can_see THEN r.notes END,
    r.created_at,
    NOT v.can_see AS is_anonymous
  FROM public.restaurants r
  JOIN public.profiles p ON p.user_id = r.user_id
  CROSS JOIN LATERAL (
    SELECT (
      r.user_id = auth.uid()
      OR NOT COALESCE(p.is_private, false)
      OR EXISTS (
        SELECT 1 FROM public.follows f
        WHERE f.follower_id = auth.uid()
          AND f.following_id = r.user_id
          AND f.status = 'accepted'
      )
    ) AS can_see
  ) v
  WHERE auth.uid() IS NOT NULL
    AND r.status = 'went_to'
    AND r.address IS NOT NULL
    AND btrim(r.address) <> ''
    AND COALESCE(
      NULLIF(btrim(r.place_id), ''),
      'nm:' || md5(lower(btrim(r.name)) || '|' || lower(btrim(COALESCE(r.address, ''))))
    ) = p_place_id
    AND NOT public.is_blocked_pair(auth.uid(), r.user_id)
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


CREATE OR REPLACE FUNCTION public.get_explore_lists(p_mode text DEFAULT 'all')
RETURNS TABLE (
  list_id uuid,
  list_name text,
  list_icon text,
  item_count integer,
  user_id uuid,
  username text,
  display_name text,
  avatar_emoji text,
  avatar_color text,
  is_anonymous boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.name,
    l.icon,
    COUNT(i.id)::integer,
    l.user_id,
    p.username,
    p.display_name,
    p.avatar_emoji,
    p.avatar_color,
    false
  FROM public.custom_lists l
  JOIN public.profiles p ON p.user_id = l.user_id
  JOIN public.custom_list_items i ON i.list_id = l.id
  WHERE auth.uid() IS NOT NULL
    AND NOT public.is_blocked_pair(auth.uid(), l.user_id)
    AND (
      l.user_id = auth.uid()
      OR NOT COALESCE(p.is_private, false)
      OR EXISTS (
        SELECT 1 FROM public.follows f
        WHERE f.follower_id = auth.uid()
          AND f.following_id = l.user_id
          AND f.status = 'accepted'
      )
    )
    AND (
      l.user_id = auth.uid()
      OR (
        p_mode = 'friends'
        AND EXISTS (
          SELECT 1 FROM public.follows f
          WHERE f.follower_id = auth.uid()
            AND f.following_id = l.user_id
            AND f.status = 'accepted'
        )
      )
      OR p_mode = 'all'
    )
  GROUP BY l.id, l.name, l.icon, l.user_id, p.username, p.display_name, p.avatar_emoji, p.avatar_color
  ORDER BY MAX(i.created_at) DESC;
$$;

REVOKE ALL ON FUNCTION public.get_explore_lists(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_explore_lists(text) TO authenticated;
