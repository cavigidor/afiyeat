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
--   an object entry must carry a string "id" of 8-64 [A-Za-z0-9_-]
--   characters, and no two entries of one array may share an id. This is
--   what makes "the same entry twice" unstorable on every write path,
--   not only through apply_checklist_op.
--   nothing nested deeper than that.
CREATE OR REPLACE FUNCTION public.lists_v2_details_ok(d jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  k text; v jsonb; e jsonb; ek text; ev jsonb; n integer := 0; ids text[];
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
        ids := '{}';
        FOR e IN SELECT * FROM jsonb_array_elements(v) LOOP
          CASE jsonb_typeof(e)
            WHEN 'string' THEN
              IF char_length(e #>> '{}') > 200 THEN RETURN false; END IF;
            WHEN 'number' THEN
              NULL;
            WHEN 'object' THEN
              IF (SELECT count(*) FROM jsonb_object_keys(e)) > 8 THEN RETURN false; END IF;
              IF jsonb_typeof(e -> 'id') IS DISTINCT FROM 'string'
                 OR (e ->> 'id') !~ '^[A-Za-z0-9_-]{8,64}$'
                 OR (e ->> 'id') = ANY (ids) THEN
                RETURN false;
              END IF;
              ids := ids || (e ->> 'id');
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
    OR (preset_key IS NOT NULL AND preset_version IS NOT NULL
        AND public.lists_v2_key_ok(preset_key) AND preset_version >= 1)
  );
-- Correction (2026-11-15): the earlier form had no IS NOT NULL tests. A
-- CHECK passes when its expression is NULL, so ('drinks', NULL) was
-- accepted. Both halves are now stated explicitly.
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
--     p_visibility: 'profile' or 'private'. When omitted or NULL the
--                   audience is lists_v2_default_visibility(preset):
--                   Only me for Travel, today's default (profile) for
--                   everything else. Travel is shared only when the
--                   caller says so. Anonymous sharing needs explicit
--                   consent and is not offered here.
--     Two calls with the same id at the same moment: the second waits for
--     the first and then returns the same list (no error, nothing twice).
CREATE OR REPLACE FUNCTION public.lists_v2_default_visibility(p_preset_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT CASE WHEN p_preset_key = 'travel' THEN 'private' ELSE 'profile' END $$;

-- Every new Travel row starts Only me, whatever path inserts it (this
-- function, a direct insert from a newer client, a retry). A database
-- default cannot depend on another column, and an insert cannot tell an
-- omitted audience from an explicit one, so sharing a Travel list is
-- always a second, explicit write: an UPDATE of visibility, which this
-- trigger does not touch. Lists without the travel preset are unaffected.
CREATE OR REPLACE FUNCTION public.lists_v2_travel_starts_private()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.preset_key = 'travel' THEN
    NEW.visibility := 'private';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS lists_v2_travel_starts_private ON public.custom_lists;
CREATE TRIGGER lists_v2_travel_starts_private
  BEFORE INSERT ON public.custom_lists
  FOR EACH ROW EXECUTE FUNCTION public.lists_v2_travel_starts_private();

-- The 9-argument signature is unchanged; only the default of the last
-- argument differs, which CREATE OR REPLACE cannot alter in place.
DROP FUNCTION IF EXISTS public.create_list_from_preset(uuid, text, text, integer, text, jsonb, jsonb, jsonb, text);
CREATE OR REPLACE FUNCTION public.create_list_from_preset(
  p_id             uuid,
  p_name           text,
  p_preset_key     text    DEFAULT NULL,
  p_preset_version integer DEFAULT NULL,
  p_icon           text    DEFAULT NULL,
  p_settings       jsonb   DEFAULT '{}'::jsonb,
  p_statuses       jsonb   DEFAULT '["To Do", "Done"]'::jsonb,
  p_categories     jsonb   DEFAULT '[]'::jsonb,
  p_visibility     text    DEFAULT NULL
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
  v_vis   text := COALESCE(p_visibility, public.lists_v2_default_visibility(p_preset_key));
  v_rows  integer;
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
  IF v_vis NOT IN ('profile', 'private') THEN
    RAISE EXCEPTION 'visibility must be profile or private' USING ERRCODE = '22023';
  END IF;
  IF (p_preset_key IS NULL) <> (p_preset_version IS NULL) THEN
    RAISE EXCEPTION 'preset key and preset version must be given together' USING ERRCODE = '22023';
  END IF;
  IF p_preset_key IS NOT NULL
     AND (NOT public.lists_v2_key_ok(p_preset_key) OR p_preset_version < 1) THEN
    RAISE EXCEPTION 'invalid preset key or preset version' USING ERRCODE = '22023';
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
    v_vis, p_preset_key, p_preset_version
  )
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Nothing inserted: the id already exists. Either this user created it
  -- (an earlier attempt, or one finishing at this moment on another
  -- connection - the insert above waits for it) and the call is a safe
  -- retry, or the id belongs to someone else.
  IF v_rows = 0 THEN
    SELECT user_id INTO v_owner FROM public.custom_lists WHERE id = p_id;
    IF FOUND AND v_owner = v_uid THEN
      RETURN p_id;
    END IF;
    RAISE EXCEPTION 'list id is already in use' USING ERRCODE = '23505';
  END IF;

  -- The insert trigger made a Travel list Only me; an explicit audience
  -- from the caller is applied here as its own write.
  IF p_preset_key = 'travel' AND p_visibility = 'profile' THEN
    UPDATE public.custom_lists SET visibility = 'profile' WHERE id = p_id AND user_id = v_uid;
  END IF;

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
--     add: the entry's identity is entry.id and nothing else. entry.id is
--          required; an outer "id", if sent, must be identical or the call
--          is refused. The entry is rebuilt from the five known keys
--          (unknown keys are refused), so what is compared is what is
--          stored. An id that is already present does nothing (safe retry;
--          the first stored entry wins).
--     set / remove / move on an id that is gone do nothing. set cannot
--          change an id, and its value must have the key's type.
CREATE OR REPLACE FUNCTION public.lists_v2_checklist_entry(e jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF jsonb_typeof(e) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'add needs an entry object' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('id', 'text', 'price', 'link', 'done')) THEN
    RAISE EXCEPTION 'an entry may hold only id, text, price, link and done' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(e -> 'id') IS DISTINCT FROM 'string' OR (e ->> 'id') !~ '^[A-Za-z0-9_-]{8,64}$' THEN
    RAISE EXCEPTION 'entry.id must be a string of 8 to 64 characters' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(e -> 'text') IS DISTINCT FROM 'string'
     OR char_length(btrim(e ->> 'text')) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'entry.text must be 1 to 500 characters' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(jsonb_typeof(e -> 'price'), 'null') NOT IN ('number', 'null') THEN
    RAISE EXCEPTION 'entry.price must be a number' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(jsonb_typeof(e -> 'link'), 'null') NOT IN ('string', 'null')
     OR char_length(COALESCE(e ->> 'link', '')) > 500 THEN
    RAISE EXCEPTION 'entry.link must be text of at most 500 characters' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(jsonb_typeof(e -> 'done'), 'boolean') <> 'boolean' THEN
    RAISE EXCEPTION 'entry.done must be true or false' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'id',    e -> 'id',
    'text',  to_jsonb(btrim(e ->> 'text')),
    'price', COALESCE(e -> 'price', 'null'::jsonb),
    'link',  COALESCE(e -> 'link',  'null'::jsonb),
    'done',  COALESCE(e -> 'done',  'false'::jsonb));
END
$$;

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
  v_id   text := p_op ->> 'id';
  v_key  text := p_op ->> 'key';
  v_val  jsonb := p_op -> 'value';
BEGIN
  IF NOT public.lists_v2_key_ok(p_field) THEN
    RAISE EXCEPTION 'invalid field' USING ERRCODE = '22023';
  END IF;
  IF v_kind = 'add' THEN
    -- Validates and rebuilds the entry; its id is the only identity.
    v_entry := public.lists_v2_checklist_entry(p_op -> 'entry');
    IF p_op ? 'id' AND (jsonb_typeof(p_op -> 'id') IS DISTINCT FROM 'string'
                        OR v_id IS DISTINCT FROM (v_entry ->> 'id')) THEN
      RAISE EXCEPTION 'the operation id and entry.id differ' USING ERRCODE = '22023';
    END IF;
    v_id := v_entry ->> 'id';
  ELSIF jsonb_typeof(p_op -> 'id') IS DISTINCT FROM 'string' OR v_id !~ '^[A-Za-z0-9_-]{8,64}$' THEN
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
    IF (v_key = 'text'  AND (jsonb_typeof(v_val) <> 'string' OR char_length(btrim(v_val #>> '{}')) NOT BETWEEN 1 AND 500))
    OR (v_key = 'price' AND jsonb_typeof(v_val) NOT IN ('number', 'null'))
    OR (v_key = 'link'  AND (jsonb_typeof(v_val) NOT IN ('string', 'null') OR char_length(COALESCE(v_val #>> '{}', '')) > 500))
    OR (v_key = 'done'  AND jsonb_typeof(v_val) <> 'boolean') THEN
      RAISE EXCEPTION 'value has the wrong type for %', v_key USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(jsonb_agg(
             CASE WHEN x.value ->> 'id' = v_id
                  THEN jsonb_set(x.value, ARRAY[v_key], v_val, true)
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
-- lists_v2_default_visibility and lists_v2_checklist_entry are pure helpers (no table access);
-- they keep the default EXECUTE grant, like the other lists_v2_* validators.

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
