-- =====================================================================
-- Afiyeat Lists V2 - OWNER FIELDS AND BREW RECORDS - PROPOSAL FOR PM REVIEW
-- Status: NOT APPROVED. NOT APPLIED ANYWHERE. Not a migration.
-- Do not paste into Lovable. Nothing here belongs in supabase/migrations/.
--
-- Smallest change that lets Lists V2 save, per account:
--   LV2-DB-1  custom fields on custom lists (text, number, date, tags,
--             choice), plus the list's field order, view and sort so they
--             follow the owner across devices;
--   LV2-DB-2  several brewing records per Coffee Beans item.
--
-- Independent of Schema A (#15): needs only the current custom_lists and
-- custom_list_items tables. If Schema A is approved later, nothing here
-- conflicts with it (different names, no shared columns).
--
-- Adds: three new tables, pure validation helpers, two triggers, three
-- functions. Changes NO existing table, column, policy, function, grant,
-- storage bucket, Edge Function or Realtime publication.
--
-- Privacy (PM decision O2, owner-only in V2): every new row is readable
-- and writable by the list owner only, whatever the list's audience.
-- Followers, strangers, shared-list partners and signed-out visitors get
-- nothing. Export (O3): only the owner's own authenticated export.
--
-- Safe to run twice (IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS).
-- Rollback: lists_v2_owner_fields_and_brews_rollback.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Validation helpers (pure; used by CHECK constraints and triggers)
-- ---------------------------------------------------------------------

-- Custom field keys: "c_" then a lower-case letter, 3-40 chars in all.
CREATE OR REPLACE FUNCTION public.lv2_field_key_ok(k text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT k IS NOT NULL AND k ~ '^c_[a-z][a-z0-9_]{0,37}$'
$$;

-- Field definitions: an array of at most 30 objects
--   {key, label, type, options?, hidden?}
-- type is text | number | date | tags | choice; choice needs 1-30 options.
CREATE OR REPLACE FUNCTION public.lv2_fields_ok(f jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d jsonb; keys text[] := '{}';
BEGIN
  IF f IS NULL OR jsonb_typeof(f) <> 'array' OR jsonb_array_length(f) > 30 THEN RETURN false; END IF;
  FOR d IN SELECT * FROM jsonb_array_elements(f) LOOP
    IF jsonb_typeof(d) <> 'object' THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(d) k WHERE k NOT IN ('key', 'label', 'type', 'options', 'hidden')) THEN RETURN false; END IF;
    IF NOT public.lv2_field_key_ok(d->>'key') OR (d->>'key') = ANY (keys) THEN RETURN false; END IF;
    keys := keys || (d->>'key');
    IF jsonb_typeof(d->'label') IS DISTINCT FROM 'string' OR length(btrim(d->>'label')) NOT BETWEEN 1 AND 60 THEN RETURN false; END IF;
    IF (d->>'type') IS NULL OR (d->>'type') NOT IN ('text', 'number', 'date', 'tags', 'choice') THEN RETURN false; END IF;
    IF d ? 'hidden' AND jsonb_typeof(d->'hidden') <> 'boolean' THEN RETURN false; END IF;
    IF (d->>'type') = 'choice' THEN
      IF jsonb_typeof(d->'options') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'options') NOT BETWEEN 1 AND 30 THEN RETURN false; END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(d->'options') o
                 WHERE jsonb_typeof(o) <> 'string' OR length(btrim(o #>> '{}')) NOT BETWEEN 1 AND 60) THEN RETURN false; END IF;
    ELSIF d ? 'options' THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;

-- Per-list layout: {field_order?: [names], view?: text, sort?: text}.
-- Names in field_order are built-in field names or custom keys.
CREATE OR REPLACE FUNCTION public.lv2_layout_ok(l jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT l IS NOT NULL AND jsonb_typeof(l) = 'object'
    AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(l) k WHERE k NOT IN ('field_order', 'view', 'sort'))
    AND (NOT l ? 'view' OR (l->>'view') IN ('list', 'cards', 'grouped', 'map'))
    AND (NOT l ? 'sort' OR (l->>'sort') IN ('recent', 'name', 'rating', 'price'))
    AND (NOT l ? 'field_order' OR (
      jsonb_typeof(l->'field_order') = 'array' AND jsonb_array_length(l->'field_order') <= 40
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(l->'field_order') e
                      WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^[a-z][a-z0-9_]{0,39}$')))
$$;

-- Values: an object of at most 30 custom keys. Shape only; the trigger in
-- section 3 checks each value against the list's definition.
CREATE OR REPLACE FUNCTION public.lv2_values_ok(v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT v IS NOT NULL AND jsonb_typeof(v) = 'object'
    AND (SELECT count(*) FROM jsonb_object_keys(v)) <= 30
    AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(v) k WHERE NOT public.lv2_field_key_ok(k))
    AND octet_length(v::text) <= 16384
$$;

-- A calendar date written YYYY-MM-DD (2026-02-30 is not one).
CREATE OR REPLACE FUNCTION public.lv2_date_ok(t text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN t ~ '^\d{4}-\d{2}-\d{2}$' AND to_char(t::date, 'YYYY-MM-DD') = t;
EXCEPTION WHEN others THEN
  RETURN false;
END $$;

-- One value against one definition.
CREATE OR REPLACE FUNCTION public.lv2_value_fits(def jsonb, val jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE def->>'type'
    WHEN 'text'   THEN jsonb_typeof(val) = 'string' AND length(val #>> '{}') <= 2000
    WHEN 'number' THEN jsonb_typeof(val) = 'number'
    WHEN 'date'   THEN jsonb_typeof(val) = 'string' AND public.lv2_date_ok(val #>> '{}')
    WHEN 'tags'   THEN jsonb_typeof(val) = 'array' AND jsonb_array_length(val) <= 30
                       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(val) t
                                       WHERE jsonb_typeof(t) <> 'string' OR length(btrim(t #>> '{}')) NOT BETWEEN 1 AND 60)
    WHEN 'choice' THEN jsonb_typeof(val) = 'string' AND (def->'options') @> jsonb_build_array(val)
    ELSE false
  END
$$;

-- Is this list the caller's own? (Used by every policy below.)
CREATE OR REPLACE FUNCTION public.lv2_owns_list(p_list_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.custom_lists l WHERE l.id = p_list_id AND l.user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------
-- 2. Tables (all new; owner-only)
-- ---------------------------------------------------------------------

-- LV2-DB-1a: the owner's field definitions and layout for one list.
CREATE TABLE IF NOT EXISTS public.custom_list_owner_settings (
  list_id    uuid PRIMARY KEY REFERENCES public.custom_lists(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  fields     jsonb NOT NULL DEFAULT '[]'::jsonb,
  layout     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_list_owner_settings_fields_check CHECK (public.lv2_fields_ok(fields)),
  CONSTRAINT custom_list_owner_settings_layout_check CHECK (public.lv2_layout_ok(layout))
);

-- LV2-DB-1b: the owner's custom values for one item.
CREATE TABLE IF NOT EXISTS public.custom_list_item_owner_values (
  item_id    uuid PRIMARY KEY REFERENCES public.custom_list_items(id) ON DELETE CASCADE,
  list_id    uuid NOT NULL REFERENCES public.custom_lists(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  "values"   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_list_item_owner_values_check CHECK (public.lv2_values_ok("values"))
);
CREATE INDEX IF NOT EXISTS custom_list_item_owner_values_list_idx ON public.custom_list_item_owner_values (list_id);

-- LV2-DB-2: brewing records, any number per item.
CREATE TABLE IF NOT EXISTS public.custom_list_item_brews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       uuid NOT NULL REFERENCES public.custom_list_items(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  brewed_on     date NOT NULL DEFAULT current_date,
  method        text CHECK (method IS NULL OR length(btrim(method)) BETWEEN 1 AND 40),
  dose_g        numeric(5,1) CHECK (dose_g IS NULL OR (dose_g > 0 AND dose_g <= 1000)),
  water_g       numeric(6,1) CHECK (water_g IS NULL OR (water_g > 0 AND water_g <= 5000)),
  grind         text CHECK (grind IS NULL OR length(btrim(grind)) BETWEEN 1 AND 40),
  water_temp_c  numeric(4,1) CHECK (water_temp_c IS NULL OR (water_temp_c >= 0 AND water_temp_c <= 100)),
  brew_seconds  integer CHECK (brew_seconds IS NULL OR (brew_seconds > 0 AND brew_seconds <= 86400)),
  rating        numeric(3,1) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 10)),
  notes         text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS custom_list_item_brews_item_idx ON public.custom_list_item_brews (item_id, brewed_on DESC, created_at DESC);

-- ---------------------------------------------------------------------
-- 3. Integrity triggers
-- ---------------------------------------------------------------------

-- Values: the row's list must be the item's list, and every key must be
-- defined for that list with a value of the defined type. (Hidden fields
-- still accept values: hiding never deletes or blocks data, decision O1.)
CREATE OR REPLACE FUNCTION public.lv2_check_owner_values()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE defs jsonb; k text; d jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.custom_list_items i WHERE i.id = NEW.item_id AND i.list_id = NEW.list_id) THEN
    RAISE EXCEPTION 'item % is not on list %', NEW.item_id, NEW.list_id USING ERRCODE = '23514';
  END IF;
  SELECT s.fields INTO defs FROM public.custom_list_owner_settings s WHERE s.list_id = NEW.list_id;
  FOR k IN SELECT jsonb_object_keys(NEW."values") LOOP
    SELECT e INTO d FROM jsonb_array_elements(COALESCE(defs, '[]'::jsonb)) e WHERE e->>'key' = k;
    IF d IS NULL THEN
      RAISE EXCEPTION 'field % is not defined on this list', k USING ERRCODE = '23514';
    END IF;
    IF NOT public.lv2_value_fits(d, NEW."values" -> k) THEN
      RAISE EXCEPTION 'value for % does not fit its type %', k, d->>'type' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lv2_check_owner_values ON public.custom_list_item_owner_values;
CREATE TRIGGER lv2_check_owner_values BEFORE INSERT OR UPDATE ON public.custom_list_item_owner_values
  FOR EACH ROW EXECUTE FUNCTION public.lv2_check_owner_values();

-- Definitions: a field that still has values cannot be removed or change
-- type, and a choice option still in use cannot be removed. Removing a field goes through
-- delete_custom_list_field(), which clears the values first under a
-- confirmed count (decision O1); this trigger then has nothing to refuse.
CREATE OR REPLACE FUNCTION public.lv2_guard_field_removal()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE o jsonb; n jsonb;
BEGIN
  FOR o IN SELECT * FROM jsonb_array_elements(OLD.fields) LOOP
    SELECT e INTO n FROM jsonb_array_elements(NEW.fields) e WHERE e->>'key' = o->>'key';
    IF EXISTS (SELECT 1 FROM public.custom_list_item_owner_values v
                WHERE v.list_id = OLD.list_id AND v."values" ? (o->>'key')
                  AND (n IS NULL OR n->>'type' <> o->>'type'
                       OR (n->>'type' = 'choice' AND NOT (n->'options') @> jsonb_build_array(v."values" -> (o->>'key'))))) THEN
      RAISE EXCEPTION 'field % still has saved values; delete it with delete_custom_list_field', o->>'key'
        USING ERRCODE = '23514';
    END IF;
    n := NULL;
  END LOOP;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lv2_guard_field_removal ON public.custom_list_owner_settings;
CREATE TRIGGER lv2_guard_field_removal BEFORE UPDATE ON public.custom_list_owner_settings
  FOR EACH ROW EXECUTE FUNCTION public.lv2_guard_field_removal();

CREATE OR REPLACE FUNCTION public.lv2_touch_brew()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS lv2_touch_brew ON public.custom_list_item_brews;
CREATE TRIGGER lv2_touch_brew BEFORE UPDATE ON public.custom_list_item_brews
  FOR EACH ROW EXECUTE FUNCTION public.lv2_touch_brew();

-- ---------------------------------------------------------------------
-- 4. Row-level security: owner only, on every operation
-- ---------------------------------------------------------------------

ALTER TABLE public.custom_list_owner_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_list_owner_settings    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.custom_list_item_owner_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_list_item_owner_values FORCE ROW LEVEL SECURITY;
ALTER TABLE public.custom_list_item_brews        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_list_item_brews        FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner manages list settings" ON public.custom_list_owner_settings;
CREATE POLICY "Owner manages list settings" ON public.custom_list_owner_settings
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.lv2_owns_list(list_id))
  WITH CHECK (user_id = auth.uid() AND public.lv2_owns_list(list_id));

DROP POLICY IF EXISTS "Owner manages item values" ON public.custom_list_item_owner_values;
CREATE POLICY "Owner manages item values" ON public.custom_list_item_owner_values
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.lv2_owns_list(list_id))
  WITH CHECK (user_id = auth.uid() AND public.lv2_owns_list(list_id));

DROP POLICY IF EXISTS "Owner manages brews" ON public.custom_list_item_brews;
CREATE POLICY "Owner manages brews" ON public.custom_list_item_brews
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.custom_list_items i JOIN public.custom_lists l ON l.id = i.list_id
    WHERE i.id = custom_list_item_brews.item_id AND l.user_id = auth.uid()))
  WITH CHECK (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.custom_list_items i JOIN public.custom_lists l ON l.id = i.list_id
    WHERE i.id = custom_list_item_brews.item_id AND l.user_id = auth.uid()));

REVOKE ALL ON public.custom_list_owner_settings, public.custom_list_item_owner_values, public.custom_list_item_brews FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_list_owner_settings, public.custom_list_item_owner_values, public.custom_list_item_brews TO authenticated;
-- Not added to supabase_realtime: nothing broadcasts these rows.

-- ---------------------------------------------------------------------
-- 5. Functions (SECURITY INVOKER: they can do nothing the caller's own
--    row-level security does not already allow)
-- ---------------------------------------------------------------------

-- How many of this list's items have a value for the field: the number
-- the app shows before a permanent delete.
CREATE OR REPLACE FUNCTION public.count_custom_list_field_values(p_list_id uuid, p_key text)
RETURNS integer LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT count(*)::integer FROM public.custom_list_item_owner_values
   WHERE list_id = p_list_id AND "values" ? p_key
$$;

-- Permanent delete of one custom field (decision O1): refused unless the
-- caller's confirmed count still matches; then the values and the
-- definition go together, in one transaction.
CREATE OR REPLACE FUNCTION public.delete_custom_list_field(p_list_id uuid, p_key text, p_expected_count integer)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_fields jsonb; v_count integer;
BEGIN
  SELECT fields INTO v_fields FROM public.custom_list_owner_settings
   WHERE list_id = p_list_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fields) e WHERE e->>'key' = p_key) THEN
    RAISE EXCEPTION 'no such field' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.custom_list_item_owner_values WHERE list_id = p_list_id FOR UPDATE;
  v_count := public.count_custom_list_field_values(p_list_id, p_key);
  IF p_expected_count IS DISTINCT FROM v_count THEN
    RAISE EXCEPTION 'count changed: % values now, % confirmed', v_count, p_expected_count USING ERRCODE = '40001';
  END IF;
  UPDATE public.custom_list_item_owner_values SET "values" = "values" - p_key
   WHERE list_id = p_list_id AND "values" ? p_key;
  UPDATE public.custom_list_owner_settings
     SET fields = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(v_fields) e WHERE e->>'key' <> p_key), '[]'::jsonb),
         layout = CASE WHEN layout ? 'field_order'
                       THEN jsonb_set(layout, '{field_order}', COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(layout->'field_order') x WHERE x #>> '{}' <> p_key), '[]'::jsonb))
                       ELSE layout END
   WHERE list_id = p_list_id;
  RETURN v_count;
END $$;

-- The owner's own export (decision O3): their settings, values and brews.
-- Public, shared and anonymous exports never call this.
CREATE OR REPLACE FUNCTION public.export_my_list_owner_data()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'settings', COALESCE((SELECT jsonb_agg(to_jsonb(s) - 'user_id') FROM public.custom_list_owner_settings s WHERE s.user_id = auth.uid()), '[]'::jsonb),
    'values',   COALESCE((SELECT jsonb_agg(to_jsonb(v) - 'user_id') FROM public.custom_list_item_owner_values v WHERE v.user_id = auth.uid()), '[]'::jsonb),
    'brews',    COALESCE((SELECT jsonb_agg(to_jsonb(b) - 'user_id') FROM public.custom_list_item_brews b WHERE b.user_id = auth.uid()), '[]'::jsonb))
$$;

REVOKE ALL ON FUNCTION public.count_custom_list_field_values(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_custom_list_field(uuid, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.export_my_list_owner_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_custom_list_field_values(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_custom_list_field(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_list_owner_data() TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Deliberately unchanged (verified by the tests, not by this SQL)
-- ---------------------------------------------------------------------
--   * custom_lists, custom_list_items, their statuses, types and images:
--     no column, constraint, policy or trigger touched.
--   * can_view_custom_list(), discovery and preview functions: none reads
--     the new tables, so profile, discovery, anonymous and signed-out
--     views expose nothing new.
--   * shared_lists / shared_list_items, restaurants, storage, Edge
--     Functions, Realtime.
