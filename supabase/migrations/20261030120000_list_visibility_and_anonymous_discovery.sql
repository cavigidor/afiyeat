-- CP2: per-list visibility and anonymous community discovery.
--
-- Every custom list gets a visibility:
--
--   'profile'   (default - every existing list, and new lists unless the
--               owner picks otherwise) - exactly today's behaviour: with a
--               public profile, any signed-in user can see the list; with a
--               private profile, only the owner and approved followers.
--   'private'   - only the owner. Hidden from followers, the public
--               profile, discovery, search and share previews.
--   'anonymous' - an explicit opt-in. The owner sees the list normally;
--               everyone else - followers included - can only reach it
--               through the SECURITY DEFINER functions below, which return
--               an allowlisted, owner-free representation (title, item
--               names, statuses, types, ratings). Never the owner's id or
--               profile, notes, photos, addresses, coordinates, Apple place
--               IDs, timestamps or row IDs.
--
-- Nothing becomes more visible: existing rows keep 'profile', which is
-- today's rule. Table access for other people now also requires
-- visibility = 'profile', so 'private' and 'anonymous' lists drop out of
-- every direct query (profiles, follows, Home, search) at the server.
-- Revoking anonymity (or making a list private) takes effect on the next
-- request: every path re-checks visibility on each call.
--
-- Anonymous lists are reached by discovery_token, an opaque handle that
-- is not the list's id and is replaced whenever a list enters or leaves
-- 'anonymous', so a token seen earlier (e.g. while the list was on a
-- public profile) can't be matched to it later.
--
-- Non-destructive: adds two columns to custom_lists and one to
-- content_reports, replaces read policies and functions. No row is
-- changed except for the generated discovery_token values. Safe to re-run.

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------

ALTER TABLE public.custom_lists
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'profile';

ALTER TABLE public.custom_lists DROP CONSTRAINT IF EXISTS custom_lists_visibility_check;
ALTER TABLE public.custom_lists
  ADD CONSTRAINT custom_lists_visibility_check CHECK (visibility IN ('profile', 'private', 'anonymous'));

ALTER TABLE public.custom_lists
  ADD COLUMN IF NOT EXISTS discovery_token UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS custom_lists_discovery_token_key ON public.custom_lists (discovery_token);

-- The server owns discovery_token: a client can't choose one, and it is
-- replaced whenever the list moves into or out of 'anonymous'.
CREATE OR REPLACE FUNCTION public.custom_lists_discovery_token()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.discovery_token := gen_random_uuid();
  ELSIF (OLD.visibility = 'anonymous') IS DISTINCT FROM (NEW.visibility = 'anonymous') THEN
    NEW.discovery_token := gen_random_uuid();
  ELSE
    NEW.discovery_token := OLD.discovery_token;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS custom_lists_discovery_token ON public.custom_lists;
CREATE TRIGGER custom_lists_discovery_token
  BEFORE INSERT OR UPDATE ON public.custom_lists
  FOR EACH ROW EXECUTE FUNCTION public.custom_lists_discovery_token();

-- Reports filed against an anonymous list (see report_discoverable_list).
ALTER TABLE public.content_reports
  ADD COLUMN IF NOT EXISTS via_anonymous BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------
-- 2. Who may read a list (and its items, types, statuses, photos)
-- ---------------------------------------------------------------------

-- The single rule behind every read policy below. p_author, when given,
-- must be the list's owner (an item written by someone else into a list -
-- the gap the custom_list_items owner-check migration closes - is never
-- shown to other people).
CREATE OR REPLACE FUNCTION public.can_view_custom_list(p_list_id UUID, p_author UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.custom_lists l
    LEFT JOIN public.profiles p ON p.user_id = l.user_id
    WHERE l.id = p_list_id
      AND auth.uid() IS NOT NULL
      AND (p_author IS NULL OR p_author = l.user_id)
      AND (
        l.user_id = auth.uid()
        OR (
          l.visibility = 'profile'
          AND p.user_id IS NOT NULL
          AND NOT public.is_blocked_pair(auth.uid(), l.user_id)
          AND (
            NOT COALESCE(p.is_private, false)
            OR EXISTS (
              SELECT 1 FROM public.follows f
              WHERE f.follower_id = auth.uid()
                AND f.following_id = l.user_id
                AND f.status = 'accepted'
            )
          )
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION public.can_view_custom_list(UUID, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_view_custom_list(UUID, UUID) TO authenticated;

-- Lists. The owner policy ("Users can view their own custom lists") and
-- the restrictive block/moderation policies are unchanged.
DROP POLICY IF EXISTS "Users can view custom lists of public profiles" ON public.custom_lists;
DROP POLICY IF EXISTS "Users can view custom lists of people they follow" ON public.custom_lists;
DROP POLICY IF EXISTS "Users can view custom lists shared with them" ON public.custom_lists;
CREATE POLICY "Users can view custom lists shared with them"
  ON public.custom_lists FOR SELECT TO authenticated
  USING (public.can_view_custom_list(id));

-- Items.
DROP POLICY IF EXISTS "Users can view custom list items of public profiles" ON public.custom_list_items;
DROP POLICY IF EXISTS "Users can view custom list items of people they follow" ON public.custom_list_items;
DROP POLICY IF EXISTS "Users can view items of custom lists shared with them" ON public.custom_list_items;
CREATE POLICY "Users can view items of custom lists shared with them"
  ON public.custom_list_items FOR SELECT TO authenticated
  USING (public.can_view_custom_list(list_id, user_id));

-- Types (two historical pairs of policies with different names).
DROP POLICY IF EXISTS "Users can view custom list types of public profiles" ON public.custom_list_types;
DROP POLICY IF EXISTS "Users can view custom list types of people they follow" ON public.custom_list_types;
DROP POLICY IF EXISTS "Users can view list types of public profiles" ON public.custom_list_types;
DROP POLICY IF EXISTS "Users can view list types of people they follow" ON public.custom_list_types;
DROP POLICY IF EXISTS "Users can view types of custom lists shared with them" ON public.custom_list_types;
CREATE POLICY "Users can view types of custom lists shared with them"
  ON public.custom_list_types FOR SELECT TO authenticated
  USING (public.can_view_custom_list(list_id));

-- Statuses.
DROP POLICY IF EXISTS "Users can view list statuses of public profiles" ON public.custom_list_statuses;
DROP POLICY IF EXISTS "Users can view list statuses of people they follow" ON public.custom_list_statuses;
DROP POLICY IF EXISTS "Users can view statuses of custom lists shared with them" ON public.custom_list_statuses;
CREATE POLICY "Users can view statuses of custom lists shared with them"
  ON public.custom_list_statuses FOR SELECT TO authenticated
  USING (public.can_view_custom_list(list_id));

-- Photo records. (The image files themselves stay owner-only in storage,
-- as before; this only governs the rows that point at them.)
DROP POLICY IF EXISTS "Users can view custom list item images of public profiles" ON public.custom_list_item_images;
DROP POLICY IF EXISTS "Users can view custom list item images of people they follow" ON public.custom_list_item_images;
DROP POLICY IF EXISTS "Users can view photos of custom lists shared with them" ON public.custom_list_item_images;
CREATE POLICY "Users can view photos of custom lists shared with them"
  ON public.custom_list_item_images FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.custom_list_items i
      WHERE i.id = custom_list_item_images.item_id
        AND i.user_id = custom_list_item_images.user_id
        AND public.can_view_custom_list(i.list_id, i.user_id)
    )
  );

-- A reporter can normally read back their own report, which names the
-- reported user. For a report about an anonymous list that would reveal
-- the owner, so those rows are never readable by reporters.
-- Moderation reads reports through SECURITY DEFINER functions and the
-- service role, which are unaffected.
DROP POLICY IF EXISTS "Anonymous list reports are not readable by reporters" ON public.content_reports;
CREATE POLICY "Anonymous list reports are not readable by reporters"
  ON public.content_reports AS RESTRICTIVE FOR SELECT
  USING (NOT via_anonymous OR public.is_moderator());

-- ---------------------------------------------------------------------
-- 3. Discovery: lists people can browse and search
-- ---------------------------------------------------------------------

-- The return shape gains discovery_token and the arguments gain search and
-- paging, so the old one-argument function is replaced (callers that pass
-- only p_mode keep working through the defaults).
DROP FUNCTION IF EXISTS public.get_explore_lists(text);
DROP FUNCTION IF EXISTS public.get_explore_lists(text, text, integer, integer);

CREATE FUNCTION public.get_explore_lists(
  p_mode TEXT DEFAULT 'all',
  p_query TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  list_id UUID,
  list_name TEXT,
  list_icon TEXT,
  item_count INTEGER,
  user_id UUID,
  username TEXT,
  display_name TEXT,
  avatar_emoji TEXT,
  avatar_color TEXT,
  is_anonymous BOOLEAN,
  discovery_token UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH viewer AS (
    SELECT auth.uid() AS uid,
           -- Escape LIKE wildcards so a search is always literal text.
           CASE
             WHEN NULLIF(btrim(p_query), '') IS NULL THEN NULL
             ELSE '%' || replace(replace(replace(left(btrim(p_query), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%'
           END AS pattern
  ),
  shaped AS (
    SELECT
      l.id, l.name, l.icon, l.user_id, l.discovery_token,
      p.username, p.display_name, p.avatar_emoji, p.avatar_color,
      CASE
        WHEN l.user_id = v.uid THEN 'identified'
        WHEN l.visibility = 'profile' AND (
          NOT COALESCE(p.is_private, false)
          OR EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = v.uid AND f.following_id = l.user_id AND f.status = 'accepted'
          )
        ) THEN 'identified'
        WHEN l.visibility = 'anonymous' THEN 'anonymous'
      END AS shown_as,
      l.user_id = v.uid AS is_own,
      EXISTS (
        SELECT 1 FROM public.follows f
        WHERE f.follower_id = v.uid AND f.following_id = l.user_id AND f.status = 'accepted'
      ) AS is_followed,
      v.pattern
    FROM public.custom_lists l
    JOIN public.profiles p ON p.user_id = l.user_id
    CROSS JOIN viewer v
    WHERE v.uid IS NOT NULL
      AND NOT public.is_blocked_pair(v.uid, l.user_id)
      AND NOT public.is_moderation_hidden('custom_list', l.id, l.user_id)
  ),
  chosen AS (
    SELECT s.*,
      agg.n,
      agg.last_at
    FROM shaped s
    CROSS JOIN LATERAL (
      SELECT count(*)::integer AS n, max(i.created_at) AS last_at
      FROM public.custom_list_items i
      WHERE i.list_id = s.id
        AND i.user_id = s.user_id
        AND (s.is_own OR NOT public.is_moderation_hidden('custom_list_item', i.id, i.user_id))
    ) agg
    WHERE s.shown_as IS NOT NULL
      AND agg.n > 0
      -- 'friends' is you plus people you follow, identified only: an
      -- anonymous list must never be narrowed down to "someone you follow".
      AND (
        s.is_own
        OR (p_mode = 'friends' AND s.shown_as = 'identified' AND s.is_followed)
        OR COALESCE(p_mode, 'all') <> 'friends'
      )
      AND (
        s.pattern IS NULL
        OR s.name ILIKE s.pattern
        OR EXISTS (
          SELECT 1 FROM public.custom_list_items i
          WHERE i.list_id = s.id AND i.user_id = s.user_id
            AND i.name ILIKE s.pattern
            AND (s.is_own OR NOT public.is_moderation_hidden('custom_list_item', i.id, i.user_id))
        )
        OR EXISTS (
          SELECT 1 FROM public.custom_list_types t
          WHERE t.list_id = s.id AND t.name ILIKE s.pattern
        )
      )
  )
  SELECT
    CASE WHEN c.shown_as = 'identified' THEN c.id END,
    c.name,
    c.icon,
    c.n,
    CASE WHEN c.shown_as = 'identified' THEN c.user_id END,
    CASE WHEN c.shown_as = 'identified' THEN c.username END,
    CASE WHEN c.shown_as = 'identified' THEN c.display_name END,
    CASE WHEN c.shown_as = 'identified' THEN c.avatar_emoji END,
    CASE WHEN c.shown_as = 'identified' THEN c.avatar_color END,
    c.shown_as = 'anonymous',
    CASE WHEN c.shown_as = 'anonymous' THEN c.discovery_token END
  FROM chosen c
  ORDER BY c.last_at DESC, c.discovery_token
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;
REVOKE ALL ON FUNCTION public.get_explore_lists(TEXT, TEXT, INTEGER, INTEGER) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_explore_lists(TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. The anonymous representation of a list
-- ---------------------------------------------------------------------

-- Internal: builds the allowlisted view. Not callable by clients; reached
-- only through get_discoverable_list (anyone, when anonymous) and
-- get_list_discovery_preview (the owner, any time).
CREATE OR REPLACE FUNCTION public.custom_list_anonymous_view(p_list_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'token', l.discovery_token,
    'title', l.name,
    'icon', l.icon,
    'rating_mode', CASE WHEN l.show_rating THEN l.rating_mode END,
    'statuses', COALESCE((
      SELECT jsonb_agg(s.name ORDER BY s.sort_order NULLS LAST, s.name)
      FROM public.custom_list_statuses s
      WHERE s.list_id = l.id
    ), '[]'::jsonb),
    'types', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', t.name, 'icon', t.icon, 'color', t.color)
                       ORDER BY t.sort_order NULLS LAST, t.name)
      FROM public.custom_list_types t
      WHERE t.list_id = l.id
    ), '[]'::jsonb),
    'items', COALESCE((
      SELECT jsonb_agg(x.obj ORDER BY x.status_order NULLS LAST, x.name)
      FROM (
        SELECT
          i.name,
          s.sort_order AS status_order,
          jsonb_build_object(
            'name', i.name,
            'status', s.name,
            'types', COALESCE((
              SELECT jsonb_agg(t.name ORDER BY t.sort_order NULLS LAST, t.name)
              FROM public.custom_list_types t
              WHERE t.list_id = l.id AND t.id = ANY (i.type_ids)
            ), '[]'::jsonb),
            'rating', CASE
              WHEN NOT l.show_rating THEN NULL
              WHEN l.rating_mode = 'manual' THEN i.rating_manual
              ELSE i.rating
            END
          ) AS obj
        FROM public.custom_list_items i
        LEFT JOIN public.custom_list_statuses s ON s.id = i.status_id AND s.list_id = l.id
        WHERE i.list_id = l.id
          AND i.user_id = l.user_id
          AND NOT public.is_moderation_hidden('custom_list_item', i.id, i.user_id)
        ORDER BY s.sort_order NULLS LAST, i.name
        LIMIT 500
      ) x
    ), '[]'::jsonb)
  )
  FROM public.custom_lists l
  WHERE l.id = p_list_id;
$$;
REVOKE ALL ON FUNCTION public.custom_list_anonymous_view(UUID) FROM public, anon, authenticated;

-- Open an anonymous list by its token. NULL - indistinguishable from "no
-- such list" - when the list isn't anonymous (any more), is hidden by
-- moderation, or either side has blocked the other.
CREATE OR REPLACE FUNCTION public.get_discoverable_list(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_list_id UUID;
  v_owner UUID;
BEGIN
  IF auth.uid() IS NULL OR p_token IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT l.id, l.user_id INTO v_list_id, v_owner
  FROM public.custom_lists l
  WHERE l.discovery_token = p_token
    AND l.visibility = 'anonymous';

  IF v_list_id IS NULL
     OR public.is_blocked_pair(auth.uid(), v_owner)
     OR public.is_moderation_hidden('custom_list', v_list_id, v_owner) THEN
    RETURN NULL;
  END IF;

  RETURN public.custom_list_anonymous_view(v_list_id)
    || jsonb_build_object('is_owner', v_owner = auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.get_discoverable_list(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_discoverable_list(UUID) TO authenticated;

-- The owner's preview of exactly what get_discoverable_list shows others,
-- available before and after opting in.
CREATE OR REPLACE FUNCTION public.get_list_discovery_preview(p_list_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visibility TEXT;
BEGIN
  SELECT l.visibility INTO v_visibility
  FROM public.custom_lists l
  WHERE l.id = p_list_id AND l.user_id = auth.uid();

  IF v_visibility IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN public.custom_list_anonymous_view(p_list_id)
    || jsonb_build_object('is_owner', true, 'visibility', v_visibility);
END;
$$;
REVOKE ALL ON FUNCTION public.get_list_discovery_preview(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_list_discovery_preview(UUID) TO authenticated;

-- Report an anonymous list without learning who owns it. The report is a
-- normal content report for moderators (owner, list, reason), marked
-- via_anonymous so the reporter can't read the owner back from it.
CREATE OR REPLACE FUNCTION public.report_discoverable_list(
  p_token UUID,
  p_reason TEXT,
  p_description TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_list_id UUID;
  v_owner UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'not_found';
  END IF;

  SELECT l.id, l.user_id INTO v_list_id, v_owner
  FROM public.custom_lists l
  WHERE l.discovery_token = p_token
    AND l.visibility = 'anonymous';

  IF v_list_id IS NULL
     OR public.is_blocked_pair(auth.uid(), v_owner)
     OR public.is_moderation_hidden('custom_list', v_list_id, v_owner) THEN
    RETURN 'not_found';
  END IF;

  IF v_owner = auth.uid() THEN
    RETURN 'own_list';
  END IF;

  BEGIN
    INSERT INTO public.content_reports
      (reporter_id, reported_user_id, content_type, content_id, reason, description, via_anonymous)
    VALUES
      (auth.uid(), v_owner, 'custom_list', v_list_id, p_reason,
       NULLIF(left(btrim(COALESCE(p_description, '')), 2000), ''), true);
  EXCEPTION WHEN unique_violation THEN
    RETURN 'already_reported';
  END;

  RETURN 'reported';
END;
$$;
REVOKE ALL ON FUNCTION public.report_discoverable_list(UUID, TEXT, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.report_discoverable_list(UUID, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. Signed-out share previews: profile-visible lists only
-- ---------------------------------------------------------------------

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
    WHERE r.id = p_id AND p.is_private = false
      AND NOT public.is_moderation_hidden('restaurant', r.id, r.user_id);

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
    WHERE x.id = p_id AND x.is_public = true
      AND NOT public.is_moderation_hidden('recipe', x.id, x.user_id);

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
            SELECT ci.name, ci.address, ci.apple_place_id FROM public.custom_list_items ci
            WHERE ci.list_id = l.id
              AND NOT public.is_moderation_hidden('custom_list_item', ci.id, ci.user_id)
            ORDER BY ci.created_at DESC
            LIMIT 12
          ) i
        ), '[]'::jsonb)
      ),
      l.user_id
    INTO v_result, v_owner
    FROM public.custom_lists l
    JOIN public.profiles p ON p.user_id = l.user_id
    WHERE l.id = p_id AND p.is_private = false
      -- CP2: only lists shown on the owner's profile get a share preview.
      -- "Only me" and anonymous lists never do.
      AND l.visibility = 'profile'
      AND NOT public.is_moderation_hidden('custom_list', l.id, l.user_id);

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
