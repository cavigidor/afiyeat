-- =====================================================================
-- Afiyeat Lists V2 - SCHEMA A ADDENDUM - My Restaurants private custom fields
-- Status: PROPOSAL (recommended option P1). NOT APPROVED. NOT APPLIED ANYWHERE.
--         Do not paste into Lovable. Not a migration.
-- Depends on: schema_a_proposal.sql (user_list_settings, lists_v2_* helpers).
--
-- Problem it solves: in Schema A alone, a custom field's LABEL is owner-only
-- (user_list_settings) but its VALUE sits in restaurants.details, which every
-- reader of the restaurant row can read - any signed-in user for a public
-- profile. Owner-defined fields can hold things people would not expect to
-- publish ("who I went with", "budget", "notes for my partner").
--
-- P1 (this file):
--   * Custom-field DEFINITIONS live in user_list_settings.restaurants_config
--     under "custom_fields" (owner-only, as before).
--   * Custom-field VALUES live in a new owner-only table,
--     restaurant_private_details, one row per restaurant.
--   * The key namespace keeps them apart: custom keys start with "c_";
--     preset keys never do. restaurants.details refuses any "c_" key, and
--     the private table accepts nothing else.
--   * A value is accepted only for a key the owner has defined.
--
-- PM decisions 2026-11-15 built in:
--   O1 Hiding a field (custom_fields.<key>.hidden = true) keeps its values.
--      Deleting a field is permanent and only possible through
--      delete_restaurant_custom_field(key, expected_count): the caller must
--      pass the number of places that currently hold a value (shown to the
--      person by count_restaurant_custom_field_values first). Values and
--      definition go in one transaction. A definition cannot be removed any
--      other way while values exist (trigger on user_list_settings).
--   O2 Definitions and values stay owner-only in V2; no sharing path exists.
--   O3 export_my_restaurant_private_fields() returns them to their owner
--      only. No public, shared, discovery or anonymous path reads them.
--
-- Unchanged by design:
--   * Preset detail fields of My Restaurants (restaurants.details) keep the
--     row's existing audience - the same readers as notes and rating today.
--   * Custom lists (custom_list_items.details) keep their explicit audience:
--     Only me / profile per custom_lists.visibility via can_view_custom_list().
--   * No existing table, policy or function is altered except the CHECK
--     added to restaurants.details and user_list_settings, both on columns
--     Schema A itself introduces.
-- =====================================================================

-- 1. Namespace helpers ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.lists_v2_is_custom_key(k text)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$ SELECT k IS NOT NULL AND k ~ '^c_[a-z0-9_]{1,38}$' $$;

-- true when no top-level key of d is a custom key
CREATE OR REPLACE FUNCTION public.lists_v2_no_custom_keys(d jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$ SELECT d IS NULL OR jsonb_typeof(d) <> 'object'
          OR NOT EXISTS (SELECT 1 FROM jsonb_object_keys(d) k WHERE k LIKE 'c\_%') $$;

-- true when every top-level key of d is a custom key
CREATE OR REPLACE FUNCTION public.lists_v2_only_custom_keys(d jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$ SELECT jsonb_typeof(d) = 'object'
          AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(d) k WHERE NOT public.lists_v2_is_custom_key(k)) $$;

-- My Restaurants config: "fields" holds preset-field overrides (never c_),
-- "custom_fields" holds owner definitions (always c_, at most 20).
CREATE OR REPLACE FUNCTION public.lists_v2_restaurants_config_ok(c jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$ SELECT public.lists_v2_config_ok(c)
          AND (c -> 'fields' IS NULL OR (jsonb_typeof(c -> 'fields') = 'object' AND public.lists_v2_no_custom_keys(c -> 'fields')))
          AND (c -> 'custom_fields' IS NULL
               OR (public.lists_v2_only_custom_keys(c -> 'custom_fields')
                   AND (SELECT count(*) FROM jsonb_object_keys(c -> 'custom_fields')) <= 20)) $$;

-- 2. Constraints on the Schema A columns -----------------------------------
ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_details_no_custom_check;
ALTER TABLE public.restaurants
  ADD CONSTRAINT restaurants_details_no_custom_check CHECK (public.lists_v2_no_custom_keys(details));

ALTER TABLE public.user_list_settings DROP CONSTRAINT IF EXISTS user_list_settings_restaurants_config_check;
ALTER TABLE public.user_list_settings
  ADD CONSTRAINT user_list_settings_restaurants_config_check CHECK (public.lists_v2_restaurants_config_ok(restaurants_config));

-- 3. Owner-only values -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.restaurant_private_details (
  restaurant_id uuid PRIMARY KEY REFERENCES public.restaurants (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  "values"      jsonb NOT NULL DEFAULT '{}'::jsonb
                CONSTRAINT restaurant_private_details_values_check
                CHECK (public.lists_v2_details_ok("values") AND public.lists_v2_only_custom_keys("values")),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.restaurant_private_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_private_details FORCE ROW LEVEL SECURITY;

-- Every policy requires BOTH: the row is the caller's, and the restaurant is the caller's.
-- No follower, profile, discovery, moderator or service path is granted here.
DROP POLICY IF EXISTS "Owner reads own private restaurant details" ON public.restaurant_private_details;
CREATE POLICY "Owner reads own private restaurant details"
  ON public.restaurant_private_details FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         AND EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.user_id = auth.uid()));
DROP POLICY IF EXISTS "Owner inserts own private restaurant details" ON public.restaurant_private_details;
CREATE POLICY "Owner inserts own private restaurant details"
  ON public.restaurant_private_details FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()
              AND EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.user_id = auth.uid()));
DROP POLICY IF EXISTS "Owner updates own private restaurant details" ON public.restaurant_private_details;
CREATE POLICY "Owner updates own private restaurant details"
  ON public.restaurant_private_details FOR UPDATE TO authenticated
  USING (user_id = auth.uid()
         AND EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.user_id = auth.uid()))
  WITH CHECK (user_id = auth.uid()
              AND EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.user_id = auth.uid()));
DROP POLICY IF EXISTS "Owner deletes own private restaurant details" ON public.restaurant_private_details;
CREATE POLICY "Owner deletes own private restaurant details"
  ON public.restaurant_private_details FOR DELETE TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.restaurant_private_details FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_private_details TO authenticated;
-- Deliberately NOT added to the supabase_realtime publication.

-- 4. Write path ------------------------------------------------------------
-- Merge values for one of the caller's places. Every key set must be a
-- custom key the caller has defined; unset may name any custom key (so a
-- value can be cleared after its definition was removed).
CREATE OR REPLACE FUNCTION public.patch_restaurant_private_details(
  p_restaurant_id uuid,
  p_set           jsonb  DEFAULT '{}'::jsonb,
  p_unset         text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v jsonb; v_uid uuid := auth.uid(); v_defs jsonb; k text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_set IS NULL OR jsonb_typeof(p_set) <> 'object' THEN
    RAISE EXCEPTION 'set must be a JSON object' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.restaurants WHERE id = p_restaurant_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'place not found, or not yours' USING ERRCODE = '42501';
  END IF;
  SELECT restaurants_config -> 'custom_fields' INTO v_defs FROM public.user_list_settings WHERE user_id = v_uid FOR SHARE;
  FOR k IN SELECT jsonb_object_keys(p_set) LOOP
    IF NOT public.lists_v2_is_custom_key(k) OR v_defs IS NULL OR NOT (v_defs ? k) THEN
      RAISE EXCEPTION 'no custom field % is defined', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_unset, '{}'::text[])) u WHERE NOT public.lists_v2_is_custom_key(u)) THEN
    RAISE EXCEPTION 'only custom fields can be cleared here' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.restaurant_private_details AS d (restaurant_id, user_id, "values")
  VALUES (p_restaurant_id, v_uid, p_set)
  ON CONFLICT (restaurant_id) DO UPDATE
    SET "values" = (d."values" - COALESCE(p_unset, '{}'::text[])) || p_set, updated_at = now()
  RETURNING d."values" INTO v;
  RETURN v;
END
$$;
REVOKE ALL ON FUNCTION public.patch_restaurant_private_details(uuid, jsonb, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patch_restaurant_private_details(uuid, jsonb, text[]) TO authenticated;

-- Reads by patch_restaurant_private_details wait for a field deletion in progress (FOR SHARE on the
-- settings row), so a value can never be written for a field while it is being deleted.

-- 5. Definitions cannot disappear while values exist ------------------------
CREATE OR REPLACE FUNCTION public.lists_v2_guard_custom_field_removal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE k text;
BEGIN
  FOR k IN SELECT jsonb_object_keys(COALESCE(OLD.restaurants_config -> 'custom_fields', '{}'::jsonb)) LOOP
    IF NOT (COALESCE(NEW.restaurants_config -> 'custom_fields', '{}'::jsonb) ? k)
       AND EXISTS (SELECT 1 FROM public.restaurant_private_details d WHERE d.user_id = OLD.user_id AND d."values" ? k) THEN
      RAISE EXCEPTION 'custom field % still has values; hide it, or delete it with delete_restaurant_custom_field', k
        USING ERRCODE = '23503';
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS lists_v2_guard_custom_field_removal ON public.user_list_settings;
CREATE TRIGGER lists_v2_guard_custom_field_removal
  BEFORE UPDATE OF restaurants_config ON public.user_list_settings
  FOR EACH ROW EXECUTE FUNCTION public.lists_v2_guard_custom_field_removal();

-- 6. Count, then confirmed permanent delete ----------------------------------
CREATE OR REPLACE FUNCTION public.count_restaurant_custom_field_values(p_key text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT count(*)::integer FROM public.restaurant_private_details
   WHERE user_id = auth.uid() AND "values" ? p_key AND "values" -> p_key <> 'null'::jsonb
$$;

CREATE OR REPLACE FUNCTION public.delete_restaurant_custom_field(p_key text, p_expected_count integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_now integer; v_removed integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF NOT public.lists_v2_is_custom_key(p_key) THEN
    RAISE EXCEPTION 'only custom fields can be deleted' USING ERRCODE = '22023';
  END IF;
  IF p_expected_count IS NULL OR p_expected_count < 0 THEN
    RAISE EXCEPTION 'confirm with the number of places that hold a value' USING ERRCODE = '22023';
  END IF;
  -- Serialise against value writes and other deletions of this owner's fields.
  PERFORM 1 FROM public.user_list_settings WHERE user_id = v_uid AND restaurants_config -> 'custom_fields' ? p_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no custom field % is defined', p_key USING ERRCODE = '22023';
  END IF;
  v_now := public.count_restaurant_custom_field_values(p_key);
  IF v_now <> p_expected_count THEN
    RAISE EXCEPTION 'the number of places with a value is now %, not %: show it and confirm again', v_now, p_expected_count
      USING ERRCODE = '40001';
  END IF;
  UPDATE public.restaurant_private_details SET "values" = "values" - p_key, updated_at = now()
   WHERE user_id = v_uid AND "values" ? p_key;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  DELETE FROM public.restaurant_private_details WHERE user_id = v_uid AND "values" = '{}'::jsonb;
  UPDATE public.user_list_settings
     SET restaurants_config = restaurants_config #- ARRAY['custom_fields', p_key], updated_at = now()
   WHERE user_id = v_uid;
  RETURN v_removed;
END
$$;

-- 7. The owner's own export --------------------------------------------------
-- Definitions (hidden ones included, marked) and every value, for the caller only. Read through
-- row-level security as the caller (SECURITY INVOKER): it cannot return another person's data.
CREATE OR REPLACE FUNCTION public.export_my_restaurant_private_fields()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE jsonb_build_object(
    'definitions', COALESCE((SELECT restaurants_config -> 'custom_fields' FROM public.user_list_settings WHERE user_id = auth.uid()), '{}'::jsonb),
    'values', COALESCE((SELECT jsonb_agg(jsonb_build_object('restaurant_id', d.restaurant_id, 'place', r.name, 'values', d."values") ORDER BY r.name, d.restaurant_id)
                          FROM public.restaurant_private_details d JOIN public.restaurants r ON r.id = d.restaurant_id
                         WHERE d.user_id = auth.uid()), '[]'::jsonb)) END
$$;

REVOKE ALL ON FUNCTION public.count_restaurant_custom_field_values(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_restaurant_custom_field(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.export_my_restaurant_private_fields() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_restaurant_custom_field_values(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_restaurant_custom_field(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_restaurant_private_fields() TO authenticated;
-- No SECURITY DEFINER function may read restaurant_private_details (definer functions owned by a
-- BYPASSRLS role would skip its policies). tests/my_restaurants_private_fields.test.mjs P1-15 is a
-- tripwire for this; code review remains the control.
