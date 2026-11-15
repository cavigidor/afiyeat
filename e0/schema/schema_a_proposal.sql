-- =====================================================================
-- Afiyeat Lists V2 - SCHEMA A - PROPOSAL FOR PM REVIEW
-- Status: NOT APPROVED. NOT APPLIED ANYWHERE. Do not paste into Lovable.
--
-- Depends on (must already be applied):
--   20261030120000_list_visibility_and_anonymous_discovery.sql  (PR #8)
--   20261029120000_custom_list_items_owner_check.sql            (PR #7)
--
-- What it does: additive columns, one small table, and functions.
-- What it does not do: alter, drop, rename or backfill any existing
-- column; change any existing policy; touch shared lists; touch the
-- place cache or anything else derived from Apple Maps; add a brew-log
-- or any other child-entry table.
--
-- Safe to run twice (every statement is IF NOT EXISTS / OR REPLACE /
-- DROP ... IF EXISTS + CREATE).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Validation helpers (pure functions, used by CHECK constraints)
-- ---------------------------------------------------------------------

-- A field id / key: lower-case, starts with a letter, max 40 chars.
CREATE OR REPLACE FUNCTION public.lists_v2_key_ok(k text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$ SELECT k IS NOT NULL AND k ~ '^[a-z][a-z0-9_]{0,39}$' $$;

-- Structural limits for item details. Deliberately knows nothing about
-- presets: it bounds shape and size only, so adding a field to a preset
-- never needs SQL.
--   object, <= 32 KB, <= 60 keys, keys match lists_v2_key_ok
--   values: string <= 2000 chars | number | boolean | null
--           | array <= 50 of: string <= 200 | number
--                           | flat object <= 8 keys (a checklist entry:
--                             strings <= 500, number, boolean, null)
--   nothing nested deeper than that.
CREATE OR REPLACE FUNCTION public.lists_v2_details_ok(d jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  k text; v jsonb; e jsonb; ek text; ev jsonb; n integer := 0;
BEGIN
  IF d IS NULL OR jsonb_typeof(d) <> 'object' THEN RETURN false; END IF;
  IF octet_length(d::text) > 32768 THEN RETURN false; END IF;
  FOR k, v IN SELECT * FROM jsonb_each(d) LOOP
    n := n + 1;
    IF n > 60 OR NOT public.lists_v2_key_ok(k) THEN RETURN false; END IF;
    CASE jsonb_typeof(v)
      WHEN 'string' THEN
        IF char_length(v #>> '{}') > 2000 THEN RETURN false; END IF;
      WHEN 'number', 'boolean', 'null' THEN
        NULL;
      WHEN 'array' THEN
        IF jsonb_array_length(v) > 50 THEN RETURN false; END IF;
        FOR e IN SELECT * FROM jsonb_array_elements(v) LOOP
          CASE jsonb_typeof(e)
            WHEN 'string' THEN
              IF char_length(e #>> '{}') > 200 THEN RETURN false; END IF;
            WHEN 'number' THEN
              NULL;
            WHEN 'object' THEN
              IF (SELECT count(*) FROM jsonb_object_keys(e)) > 8 THEN RETURN false; END IF;
              FOR ek, ev IN SELECT * FROM jsonb_each(e) LOOP
                IF NOT public.lists_v2_key_ok(ek) THEN RETURN false; END IF;
                CASE jsonb_typeof(ev)
                  WHEN 'string' THEN
                    IF char_length(ev #>> '{}') > 500 THEN RETURN false; END IF;
                  WHEN 'number', 'boolean', 'null' THEN
                    NULL;
                  ELSE
                    RETURN false;
                END CASE;
              END LOOP;
            ELSE
              RETURN false;
          END CASE;
        END LOOP;
      ELSE
        RETURN false; -- top-level nested objects are not allowed
    END CASE;
  END LOOP;
  RETURN true;
END
$$;

-- List / My Restaurants configuration: an object of at most 32 KB.
CREATE OR REPLACE FUNCTION public.lists_v2_config_ok(c jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$ SELECT c IS NOT NULL AND jsonb_typeof(c) = 'object' AND octet_length(c::text) <= 32768 $$;

-- Applies path operations to a config object without touching anything
-- the operations do not name.
--   ops: [{"path": ["fields","abv","hidden"], "value": true},   -- set
--         {"path": ["fields","colour"]}]                        -- remove
-- At most 100 ops, paths 1-4 segments long. Missing parents are created.
CREATE OR REPLACE FUNCTION public.lists_v2_apply_ops(c jsonb, p_ops jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  op jsonb; path text[]; depth integer; i integer;
  r jsonb := COALESCE(c, '{}'::jsonb);
BEGIN
  IF p_ops IS NULL OR jsonb_typeof(p_ops) <> 'array' OR jsonb_array_length(p_ops) > 100 THEN
    RAISE EXCEPTION 'ops must be an array of at most 100 operations' USING ERRCODE = '22023';
  END IF;
  FOR op IN SELECT * FROM jsonb_array_elements(p_ops) LOOP
    IF jsonb_typeof(op) <> 'object' OR jsonb_typeof(op -> 'path') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'each operation needs a path array' USING ERRCODE = '22023';
    END IF;
    path := ARRAY(SELECT jsonb_array_elements_text(op -> 'path'));
    depth := COALESCE(array_length(path, 1), 0);
    IF depth < 1 OR depth > 4 THEN
      RAISE EXCEPTION 'path must have 1 to 4 segments' USING ERRCODE = '22023';
    END IF;
    IF op ? 'value' THEN
      FOR i IN 1 .. depth - 1 LOOP
        IF r #> path[1:i] IS NULL OR jsonb_typeof(r #> path[1:i]) <> 'object' THEN
          r := jsonb_set(r, path[1:i], '{}'::jsonb, true);
        END IF;
      END LOOP;
      r := jsonb_set(r, path, op -> 'value', true);
    ELSE
      r := r #- path;
    END IF;
  END LOOP;
  RETURN r;
END
$$;

-- ---------------------------------------------------------------------
-- 2. Columns (all nullable or defaulted; existing rows are valid as-is)
-- ---------------------------------------------------------------------

ALTER TABLE public.custom_lists
  ADD COLUMN IF NOT EXISTS preset_key     text,
  ADD COLUMN IF NOT EXISTS preset_version integer,
  ADD COLUMN IF NOT EXISTS config         jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.custom_lists DROP CONSTRAINT IF EXISTS custom_lists_preset_check;
ALTER TABLE public.custom_lists
  ADD CONSTRAINT custom_lists_preset_check CHECK (
    (preset_key IS NULL AND preset_version IS NULL)
    OR (public.lists_v2_key_ok(preset_key) AND preset_version >= 1)
  );
ALTER TABLE public.custom_lists DROP CONSTRAINT IF EXISTS custom_lists_config_check;
ALTER TABLE public.custom_lists
  ADD CONSTRAINT custom_lists_config_check CHECK (public.lists_v2_config_ok(config));

ALTER TABLE public.custom_list_items
  ADD COLUMN IF NOT EXISTS details     jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false;

ALTER TABLE public.custom_list_items DROP CONSTRAINT IF EXISTS custom_list_items_details_check;
ALTER TABLE public.custom_list_items
  ADD CONSTRAINT custom_list_items_details_check CHECK (public.lists_v2_details_ok(details));

ALTER TABLE public.custom_list_types
  ADD COLUMN IF NOT EXISTS preset_key text,
  ADD COLUMN IF NOT EXISTS is_hidden  boolean NOT NULL DEFAULT false;

ALTER TABLE public.custom_list_types DROP CONSTRAINT IF EXISTS custom_list_types_preset_key_check;
ALTER TABLE public.custom_list_types
  ADD CONSTRAINT custom_list_types_preset_key_check
  CHECK (preset_key IS NULL OR public.lists_v2_key_ok(preset_key));

-- A list cannot hold the same preset category twice.
CREATE UNIQUE INDEX IF NOT EXISTS custom_list_types_list_preset_key_key
  ON public.custom_list_types (list_id, preset_key)
  WHERE preset_key IS NOT NULL;

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_details_check;
ALTER TABLE public.restaurants
  ADD CONSTRAINT restaurants_details_check CHECK (public.lists_v2_details_ok(details));

-- ---------------------------------------------------------------------
-- 3. My Restaurants settings (one row per user, owner-only)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_list_settings (
  user_id            uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  restaurants_config jsonb NOT NULL DEFAULT '{}'::jsonb
                     CONSTRAINT user_list_settings_config_check
                     CHECK (public.lists_v2_config_ok(restaurants_config)),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_list_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own list settings" ON public.user_list_settings;
CREATE POLICY "Users can view their own list settings"
  ON public.user_list_settings FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert their own list settings" ON public.user_list_settings;
CREATE POLICY "Users can insert their own list settings"
  ON public.user_list_settings FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own list settings" ON public.user_list_settings;
CREATE POLICY "Users can update their own list settings"
  ON public.user_list_settings FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.user_list_settings FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.user_list_settings TO authenticated;

-- ---------------------------------------------------------------------
-- 4. Functions. All SECURITY INVOKER: they run as the calling user, so
--    every existing row-level-security policy still decides what they
--    may read and write. None can reach another user's rows.
-- ---------------------------------------------------------------------

-- 4.1 Create a list with its statuses and categories in one transaction.
--     p_id is chosen by the client, which makes a retry idempotent:
--     calling again with the same id returns the list that already exists.
--     p_statuses:   ["Want to Try", "Tried"]                       (1-12)
--     p_categories: [{"key":"wine","name":"Wine","color":"#6B3A80","icon":null}] (0-30)
--     p_settings:   {"show_location":false,"show_price":true,"price_mode":"manual",
--                    "show_rating":true,"rating_mode":"scale_10",
--                    "show_notes":true,"show_photos":true}
--     p_visibility: 'profile' (default) or 'private'. Anonymous sharing
--                   needs explicit consent and is not offered here.
CREATE OR REPLACE FUNCTION public.create_list_from_preset(
  p_id             uuid,
  p_name           text,
  p_preset_key     text    DEFAULT NULL,
  p_preset_version integer DEFAULT NULL,
  p_icon           text    DEFAULT NULL,
  p_settings       jsonb   DEFAULT '{}'::jsonb,
  p_statuses       jsonb   DEFAULT '["To Do", "Done"]'::jsonb,
  p_categories     jsonb   DEFAULT '[]'::jsonb,
  p_visibility     text    DEFAULT 'profile'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_owner uuid;
  v_name  text := btrim(COALESCE(p_name, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'a list id is required' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'list name must be 1 to 80 characters' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_visibility, 'profile') NOT IN ('profile', 'private') THEN
    RAISE EXCEPTION 'visibility must be profile or private' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_statuses) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_statuses) NOT BETWEEN 1 AND 12
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_statuses) s
                WHERE jsonb_typeof(s) <> 'string'
                   OR char_length(btrim(s #>> '{}')) NOT BETWEEN 1 AND 40) THEN
    RAISE EXCEPTION 'a list needs 1 to 12 statuses of 1 to 40 characters' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_categories) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_categories) > 30
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_categories) c
                WHERE jsonb_typeof(c) <> 'object'
                   OR char_length(btrim(COALESCE(c ->> 'name', ''))) NOT BETWEEN 1 AND 40) THEN
    RAISE EXCEPTION 'categories must be at most 30 objects with a name of 1 to 40 characters' USING ERRCODE = '22023';
  END IF;

  -- Idempotent retry: this user already created this list.
  SELECT user_id INTO v_owner FROM public.custom_lists WHERE id = p_id;
  IF FOUND THEN
    IF v_owner = v_uid THEN
      RETURN p_id;
    END IF;
    RAISE EXCEPTION 'list id is already in use' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.custom_lists (
    id, user_id, name, icon,
    show_location, show_price, price_mode, show_rating, rating_mode, show_notes, show_photos,
    visibility, preset_key, preset_version
  ) VALUES (
    p_id, v_uid, v_name, COALESCE(NULLIF(btrim(p_icon), ''), '📋'),
    COALESCE((p_settings ->> 'show_location')::boolean, true),
    COALESCE((p_settings ->> 'show_price')::boolean, true),
    COALESCE(p_settings ->> 'price_mode', 'dollar'),
    COALESCE((p_settings ->> 'show_rating')::boolean, false),
    COALESCE(p_settings ->> 'rating_mode', 'scale_10'),
    COALESCE((p_settings ->> 'show_notes')::boolean, true),
    COALESCE((p_settings ->> 'show_photos')::boolean, true),
    COALESCE(p_visibility, 'profile'), p_preset_key, p_preset_version
  );

  INSERT INTO public.custom_list_statuses (list_id, user_id, name, sort_order)
  SELECT p_id, v_uid, btrim(s.value #>> '{}'), (s.ord - 1)::integer
  FROM jsonb_array_elements(p_statuses) WITH ORDINALITY AS s(value, ord);

  INSERT INTO public.custom_list_types (list_id, user_id, name, color, icon, preset_key, sort_order)
  SELECT p_id, v_uid, btrim(c.value ->> 'name'),
         COALESCE(c.value ->> 'color', '#E91E63'),
         c.value ->> 'icon', c.value ->> 'key', (c.ord - 1)::integer
  FROM jsonb_array_elements(p_categories) WITH ORDINALITY AS c(value, ord);

  RETURN p_id;
END
$$;

-- 4.2 Merge detail values into one item. Keys not named are untouched.
CREATE OR REPLACE FUNCTION public.patch_item_details(
  p_item_id uuid,
  p_set     jsonb  DEFAULT '{}'::jsonb,
  p_unset   text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  IF p_set IS NULL OR jsonb_typeof(p_set) <> 'object' THEN
    RAISE EXCEPTION 'set must be a JSON object' USING ERRCODE = '22023';
  END IF;
  UPDATE public.custom_list_items
     SET details = (details - COALESCE(p_unset, '{}'::text[])) || p_set
   WHERE id = p_item_id AND user_id = auth.uid()
  RETURNING details INTO v;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item not found, or not yours' USING ERRCODE = '42501';
  END IF;
  RETURN v;
END
$$;

-- 4.3 The same for a My Restaurants place.
CREATE OR REPLACE FUNCTION public.patch_restaurant_details(
  p_restaurant_id uuid,
  p_set           jsonb  DEFAULT '{}'::jsonb,
  p_unset         text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  IF p_set IS NULL OR jsonb_typeof(p_set) <> 'object' THEN
    RAISE EXCEPTION 'set must be a JSON object' USING ERRCODE = '22023';
  END IF;
  UPDATE public.restaurants
     SET details = (details - COALESCE(p_unset, '{}'::text[])) || p_set
   WHERE id = p_restaurant_id AND user_id = auth.uid()
  RETURNING details INTO v;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'place not found, or not yours' USING ERRCODE = '42501';
  END IF;
  RETURN v;
END
$$;

-- 4.4 Merge customization into one list's config. The stored preset
--     version can only move forward.
CREATE OR REPLACE FUNCTION public.patch_list_config(
  p_list_id        uuid,
  p_ops            jsonb,
  p_preset_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  UPDATE public.custom_lists
     SET config = public.lists_v2_apply_ops(config, p_ops),
         preset_version = CASE
           WHEN preset_key IS NOT NULL AND p_preset_version IS NOT NULL
                AND p_preset_version > preset_version THEN p_preset_version
           ELSE preset_version END
   WHERE id = p_list_id AND user_id = auth.uid()
  RETURNING config INTO v;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'list not found, or not yours' USING ERRCODE = '42501';
  END IF;
  RETURN v;
END
$$;

-- 4.5 Merge customization into the caller's My Restaurants settings.
CREATE OR REPLACE FUNCTION public.patch_restaurants_config(p_ops jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v jsonb; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.user_list_settings AS s (user_id, restaurants_config)
  VALUES (v_uid, public.lists_v2_apply_ops('{}'::jsonb, p_ops))
  ON CONFLICT (user_id) DO UPDATE
    SET restaurants_config = public.lists_v2_apply_ops(s.restaurants_config, p_ops),
        updated_at = now()
  RETURNING s.restaurants_config INTO v;
  RETURN v;
END
$$;

-- 4.6 One operation on one checklist (wishlist) held in an item's details.
--     The row is locked for the length of the call, so two devices'
--     operations are applied one after the other, never over each other.
--       {"op":"add",    "entry":{"id":"<id>","text":"...","price":48,"link":null,"done":false}}
--       {"op":"set",    "id":"<id>","key":"done","value":true}     key: text|price|link|done
--       {"op":"remove", "id":"<id>"}
--       {"op":"move",   "id":"<id>","before":"<other id>"}         before omitted = to the end
--     add with an id that is already present does nothing (safe retry).
--     set / remove / move on an id that is gone do nothing.
CREATE OR REPLACE FUNCTION public.apply_checklist_op(
  p_item_id uuid,
  p_field   text,
  p_op      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_details jsonb; v_arr jsonb; v_new jsonb; v_entry jsonb;
  v_kind text := p_op ->> 'op';
  v_id   text := COALESCE(p_op ->> 'id', p_op -> 'entry' ->> 'id');
  v_key  text := p_op ->> 'key';
BEGIN
  IF NOT public.lists_v2_key_ok(p_field) THEN
    RAISE EXCEPTION 'invalid field' USING ERRCODE = '22023';
  END IF;
  IF v_id IS NULL OR v_id !~ '^[A-Za-z0-9_-]{8,64}$' THEN
    RAISE EXCEPTION 'an entry id of 8 to 64 characters is required' USING ERRCODE = '22023';
  END IF;

  SELECT details INTO v_details
    FROM public.custom_list_items
   WHERE id = p_item_id AND user_id = auth.uid()
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item not found, or not yours' USING ERRCODE = '42501';
  END IF;

  v_arr := COALESCE(v_details -> p_field, '[]'::jsonb);
  IF jsonb_typeof(v_arr) <> 'array' THEN
    RAISE EXCEPTION 'field is not a checklist' USING ERRCODE = '22023';
  END IF;

  IF v_kind = 'add' THEN
    v_entry := p_op -> 'entry';
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'add needs an entry object' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_arr) x WHERE x ->> 'id' = v_id) THEN
      v_new := v_arr;
    ELSIF jsonb_array_length(v_arr) >= 50 THEN
      RAISE EXCEPTION 'this checklist is full (50 entries)' USING ERRCODE = '23514';
    ELSE
      v_new := v_arr || jsonb_build_array(v_entry);
    END IF;

  ELSIF v_kind = 'set' THEN
    IF v_key IS NULL OR v_key NOT IN ('text', 'price', 'link', 'done') OR NOT (p_op ? 'value') THEN
      RAISE EXCEPTION 'set needs key (text, price, link or done) and value' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(jsonb_agg(
             CASE WHEN x.value ->> 'id' = v_id
                  THEN jsonb_set(x.value, ARRAY[v_key], p_op -> 'value', true)
                  ELSE x.value END
             ORDER BY x.ord), '[]'::jsonb)
      INTO v_new
      FROM jsonb_array_elements(v_arr) WITH ORDINALITY AS x(value, ord);

  ELSIF v_kind = 'remove' THEN
    SELECT COALESCE(jsonb_agg(x.value ORDER BY x.ord), '[]'::jsonb)
      INTO v_new
      FROM jsonb_array_elements(v_arr) WITH ORDINALITY AS x(value, ord)
     WHERE x.value ->> 'id' <> v_id;

  ELSIF v_kind = 'move' THEN
    SELECT x.value INTO v_entry
      FROM jsonb_array_elements(v_arr) AS x(value)
     WHERE x.value ->> 'id' = v_id
     LIMIT 1;
    IF v_entry IS NULL THEN
      v_new := v_arr;
    ELSE
      SELECT COALESCE(jsonb_agg(y.value ORDER BY y.ord), '[]'::jsonb)
        INTO v_new
        FROM (
          SELECT x.value, x.ord::numeric AS ord
            FROM jsonb_array_elements(v_arr) WITH ORDINALITY AS x(value, ord)
           WHERE x.value ->> 'id' <> v_id
          UNION ALL
          SELECT v_entry,
                 COALESCE((SELECT x.ord - 0.5
                             FROM jsonb_array_elements(v_arr) WITH ORDINALITY AS x(value, ord)
                            WHERE x.value ->> 'id' = p_op ->> 'before'
                            LIMIT 1), 1000000)
        ) y;
    END IF;

  ELSE
    RAISE EXCEPTION 'unknown operation' USING ERRCODE = '22023';
  END IF;

  UPDATE public.custom_list_items
     SET details = jsonb_set(v_details, ARRAY[p_field], v_new, true)
   WHERE id = p_item_id AND user_id = auth.uid();

  RETURN v_new;
END
$$;

-- ---------------------------------------------------------------------
-- 5. Who may call the functions: signed-in users only.
-- ---------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.create_list_from_preset(uuid, text, text, integer, text, jsonb, jsonb, jsonb, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.patch_item_details(uuid, jsonb, text[]) FROM public, anon;
REVOKE ALL ON FUNCTION public.patch_restaurant_details(uuid, jsonb, text[]) FROM public, anon;
REVOKE ALL ON FUNCTION public.patch_list_config(uuid, jsonb, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.patch_restaurants_config(jsonb) FROM public, anon;
REVOKE ALL ON FUNCTION public.apply_checklist_op(uuid, text, jsonb) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.create_list_from_preset(uuid, text, text, integer, text, jsonb, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patch_item_details(uuid, jsonb, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patch_restaurant_details(uuid, jsonb, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patch_list_config(uuid, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patch_restaurants_config(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_checklist_op(uuid, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Deliberately unchanged (verified by the test file, not by this SQL)
-- ---------------------------------------------------------------------
--   * can_view_custom_list() and every existing policy.
--   * custom_list_anonymous_view(), get_discoverable_list(),
--     get_explore_lists(), get_shared_preview(): none of them reads
--     details, config or is_favorite, so anonymous discovery and
--     signed-out previews expose nothing new.
--   * shared_lists, shared_list_items.
--   * place_cache and the apple-maps function.
