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
  SELECT restaurants_config -> 'custom_fields' INTO v_defs FROM public.user_list_settings WHERE user_id = v_uid;
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

-- Owner decisions left open (see the correction-checkpoint report):
--   O1 when a definition is deleted, keep its values (current: kept, owner-only,
--      not shown) or purge them in the same call;
--   O2 whether a custom field may later be "promoted" to the row's audience
--      (current: impossible by construction - it would need a new key);
--   O3 whether the owner's data export includes these values (export code
--      does not exist yet).
