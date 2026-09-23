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
        'place_id', r.place_id
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
          SELECT jsonb_agg(jsonb_build_object('name', i.name, 'address', i.address))
          FROM (
            SELECT name, address FROM public.custom_list_items
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