-- Explore and share previews for places saved from Apple Maps.
--
-- Places picked from Apple search store only apple_place_id; their address
-- and coordinates live in place_cache for a limited time. These functions
-- previously required restaurants.address to be set, so Apple-saved
-- places would have vanished from Explore. Now:
--
--   * A place's Explore key is its Apple ID when it has one, then the
--     legacy Mapbox place_id, then the old name+address hash - so everyone
--     who saved the same Apple place is grouped together.
--   * Name/address/coordinates come from the unexpired cache entry when
--     there is one, else from the saved rows (manually entered places).
--     When the cache entry has expired, coordinates are NULL and the app
--     looks the place up again by apple_place_id.
--   * get_explore_places gains an apple_place_id column (a drop/recreate
--     is needed because the return type changes; older app builds simply
--     ignore the extra column). get_place_comments keeps its signature.
--   * get_shared_preview includes apple_place_id for restaurants and list
--     items, so signed-out share pages can show the address too.
--
-- All block and private-profile rules from 20261004120000 are unchanged.

DROP FUNCTION IF EXISTS public.get_explore_places(text);

CREATE FUNCTION public.get_explore_places(p_mode text DEFAULT 'all')
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
  contributor_count integer,
  apple_place_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(
      NULLIF(btrim(r.apple_place_id), ''),
      NULLIF(btrim(r.place_id), ''),
      'nm:' || md5(lower(btrim(r.name)) || '|' || lower(btrim(COALESCE(r.address, ''))))
    ) AS place_id,
    COALESCE(
      (array_agg(pc.name) FILTER (WHERE pc.name IS NOT NULL))[1],
      (array_agg(r.name ORDER BY r.created_at DESC))[1]
    ),
    COALESCE(
      (array_agg(pc.address) FILTER (WHERE pc.address IS NOT NULL))[1],
      (array_agg(r.address ORDER BY r.created_at DESC) FILTER (WHERE r.address IS NOT NULL))[1]
    ),
    COALESCE(
      (array_agg(pc.latitude) FILTER (WHERE pc.latitude IS NOT NULL))[1],
      (array_agg(r.latitude ORDER BY r.created_at DESC) FILTER (WHERE r.latitude IS NOT NULL))[1]
    ),
    COALESCE(
      (array_agg(pc.longitude) FILTER (WHERE pc.longitude IS NOT NULL))[1],
      (array_agg(r.longitude ORDER BY r.created_at DESC) FILTER (WHERE r.longitude IS NOT NULL))[1]
    ),
    (array_agg(r.category ORDER BY r.created_at DESC) FILTER (WHERE r.category IS NOT NULL))[1],
    (array_agg(r.price_level ORDER BY r.created_at DESC) FILTER (WHERE r.price_level IS NOT NULL))[1],
    (AVG(r.rating) FILTER (WHERE r.rating IS NOT NULL))::double precision,
    (COUNT(r.rating) FILTER (WHERE r.rating IS NOT NULL))::integer,
    (COUNT(DISTINCT r.user_id))::integer,
    (array_agg(r.apple_place_id) FILTER (WHERE r.apple_place_id IS NOT NULL))[1]
  FROM public.restaurants r
  JOIN public.profiles p ON p.user_id = r.user_id
  LEFT JOIN public.place_cache pc
    ON pc.apple_place_id = r.apple_place_id
   AND pc.expires_at > now()
  WHERE auth.uid() IS NOT NULL
    AND r.status = 'went_to'
    AND (
      r.apple_place_id IS NOT NULL
      OR (r.address IS NOT NULL AND btrim(r.address) <> '')
    )
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
    AND (
      r.apple_place_id IS NOT NULL
      OR (r.address IS NOT NULL AND btrim(r.address) <> '')
    )
    AND COALESCE(
      NULLIF(btrim(r.apple_place_id), ''),
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


CREATE OR REPLACE FUNCTION public.get_shared_preview(p_type TEXT, p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_owner UUID;
BEGIN
  IF p_type = 'restaurant' THEN
    SELECT
      jsonb_build_object(
        'type', 'restaurant',
        'id', r.id,
        'name', r.name,
        'address', r.address,
        'category', r.category,
        'rating', r.rating,
        'price_level', r.price_level,
        'status', r.status,
        'latitude', r.latitude,
        'longitude', r.longitude,
        'place_id', r.place_id,
        'apple_place_id', r.apple_place_id
      ),
      r.user_id
    INTO v_result, v_owner
    FROM public.restaurants r
    JOIN public.profiles p ON p.user_id = r.user_id
    WHERE r.id = p_id AND p.is_private = false;

  ELSIF p_type = 'recipe' THEN
    SELECT
      jsonb_build_object(
        'type', 'recipe',
        'id', x.id,
        'title', x.title,
        'description', x.description,
        'prep_time_minutes', x.prep_time_minutes,
        'cook_time_minutes', x.cook_time_minutes,
        'servings', x.servings,
        'difficulty', x.difficulty,
        'cook_temp', x.cook_temp,
        'cook_temp_unit', x.cook_temp_unit,
        'ingredients', x.ingredients,
        'instructions', x.instructions,
        'tags', x.tags,
        'image_url', x.image_url
      ),
      x.user_id
    INTO v_result, v_owner
    FROM public.recipes x
    WHERE x.id = p_id AND x.is_public = true;

  ELSIF p_type = 'custom_list' THEN
    SELECT
      jsonb_build_object(
        'type', 'custom_list',
        'id', l.id,
        'name', l.name,
        'icon', l.icon,
        'color', l.color,
        'item_count', (SELECT count(*) FROM public.custom_list_items i WHERE i.list_id = l.id),
        'items', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'name', i.name,
            'address', i.address,
            'apple_place_id', i.apple_place_id
          ))
          FROM (
            SELECT name, address, apple_place_id FROM public.custom_list_items
            WHERE list_id = l.id
            ORDER BY created_at DESC
            LIMIT 12
          ) i
        ), '[]'::jsonb)
      ),
      l.user_id
    INTO v_result, v_owner
    FROM public.custom_lists l
    JOIN public.profiles p ON p.user_id = l.user_id
    WHERE l.id = p_id AND p.is_private = false;

  ELSE
    RETURN NULL;
  END IF;

  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;

  -- A signed-in viewer who has blocked the owner, or been blocked by
  -- them, gets nothing - the same outcome the block policies give them
  -- everywhere else.
  IF auth.uid() IS NOT NULL AND public.is_blocked_pair(auth.uid(), v_owner) THEN
    RETURN NULL;
  END IF;

  RETURN v_result || jsonb_build_object(
    'owner', (
      SELECT jsonb_build_object(
        'user_id', p.user_id,
        'display_name', p.display_name,
        'username', p.username,
        'avatar_emoji', p.avatar_emoji,
        'avatar_color', p.avatar_color
      )
      FROM public.profiles p
      WHERE p.user_id = v_owner
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_shared_preview(TEXT, UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.get_shared_preview(TEXT, UUID) TO anon, authenticated;