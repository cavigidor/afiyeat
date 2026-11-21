-- =====================================================================
-- Afiyeat Lists V2 - PRESET ITEM FIELDS (owner-only) - FOR ISOLATED TESTING
-- Status: approved by the PM for isolated/local testing only (2026-11-20).
-- NOT a migration. NOT applied to production. Do not paste into Lovable.
--
-- The two-table part of PR #24 (LV2-DB-1), trimmed to what preset item
-- fields need:
--   custom_list_owner_settings     one row per list: its field definitions
--   custom_list_item_owner_values  one row per item: its values
-- plus type/shape validation, owner-only row-level security, a counted
-- and confirmed field delete, and the owner's own export.
--
-- Left out on purpose (PM, 2026-11-20): the brew-log table, the per-list
-- layout column (field order, view, sort) and everything from Schema A.
--
-- Changes NO existing table, column, policy, function, grant, storage
-- bucket, Edge Function or Realtime publication, so every list keeps its
-- current public / profile / anonymous behaviour.
--
-- Privacy (PM decision O2): definitions and values are readable and
-- writable by the list owner only, whatever the list's audience.
-- Followers, strangers, shared-list partners and signed-out visitors get
-- nothing, and no existing function (discovery, previews, anonymous view)
-- reads these tables.
--
-- Safe to run twice. Rollback: lists_v2_owner_fields_rollback.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Validation helpers (pure)
-- ---------------------------------------------------------------------

-- Field keys: "c_" then a lower-case letter, 3-40 characters in all.
CREATE OR REPLACE FUNCTION public.lv2_field_key_ok(k text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT k IS NOT NULL AND k ~ '^c_[a-z][a-z0-9_]{0,37}$'
$$;

-- Options of a choice or multi field: 1-40 distinct strings of 1-60 characters.
CREATE OR REPLACE FUNCTION public.lv2_options_ok(o jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(o) = 'array' AND jsonb_array_length(o) BETWEEN 1 AND 40
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(o) x
                    WHERE jsonb_typeof(x) <> 'string' OR length(btrim(x #>> '{}')) NOT BETWEEN 1 AND 60)
    AND (SELECT count(DISTINCT x #>> '{}') FROM jsonb_array_elements(o) x) = jsonb_array_length(o)
$$;

-- Field definitions: an array of at most 30 objects {key, label, type, options?, hidden?}.
--   text | number | date | tags   free values of that type
--   choice                         one of "options"
--   multi                          any number of "options" (e.g. Coffee "Best for")
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
    IF (d->>'type') IS NULL OR (d->>'type') NOT IN ('text', 'number', 'date', 'tags', 'choice', 'multi') THEN RETURN false; END IF;
    IF d ? 'hidden' AND jsonb_typeof(d->'hidden') <> 'boolean' THEN RETURN false; END IF;
    IF (d->>'type') IN ('choice', 'multi') THEN
      IF NOT public.lv2_options_ok(d->'options') THEN RETURN false; END IF;
    ELSIF d ? 'options' THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;

-- Values: an object of at most 30 field keys, 16 KB at most. Shape only;
-- the trigger in section 3 checks each value against the list's definitions.
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
    WHEN 'multi'  THEN jsonb_typeof(val) = 'array' AND jsonb_array_length(val) BETWEEN 1 AND 40
                       AND (def->'options') @> val
                       AND (SELECT count(DISTINCT x) FROM jsonb_array_elements(val) x) = jsonb_array_length(val)
    ELSE false
  END
$$;

-- Is this list the caller's own? Invoker rights: it sees only what the caller may see.
CREATE OR REPLACE FUNCTION public.lv2_owns_list(p_list_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.custom_lists l WHERE l.id = p_list_id AND l.user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------
-- 2. Tables (new; owner-only)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.custom_list_owner_settings (
  list_id    uuid PRIMARY KEY REFERENCES public.custom_lists(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  fields     jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_list_owner_settings_fields_check CHECK (public.lv2_fields_ok(fields))
);

CREATE TABLE IF NOT EXISTS public.custom_list_item_owner_values (
  item_id    uuid PRIMARY KEY REFERENCES public.custom_list_items(id) ON DELETE CASCADE,
  list_id    uuid NOT NULL REFERENCES public.custom_lists(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  "values"   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_list_item_owner_values_check CHECK (public.lv2_values_ok("values"))
);
CREATE INDEX IF NOT EXISTS custom_list_item_owner_values_list_idx ON public.custom_list_item_owner_values (list_id);

-- ---------------------------------------------------------------------
-- 3. Integrity triggers
-- ---------------------------------------------------------------------

-- Values: the item must be on that list, and every key must be defined for
-- the list with a value of the defined type. Hidden fields still accept
-- values: hiding never deletes or blocks data (decision O1).
CREATE OR REPLACE FUNCTION public.lv2_check_owner_values()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE defs jsonb; k text; d jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.custom_list_items i WHERE i.id = NEW.item_id AND i.list_id = NEW.list_id) THEN
    RAISE EXCEPTION 'item % is not on list %', NEW.item_id, NEW.list_id USING ERRCODE = '23514';
  END IF;
  SELECT s.fields INTO defs FROM public.custom_list_owner_settings s WHERE s.list_id = NEW.list_id;
  FOR k IN SELECT jsonb_object_keys(NEW."values") LOOP
    d := NULL;
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

-- Definitions: no edit may strand a saved value. A field that still has
-- values can't be removed, change to a type its values don't fit, or lose
-- an option a value uses.
-- Removing a field goes through delete_custom_list_field(), which clears its
-- values first under a confirmed count (decision O1).
CREATE OR REPLACE FUNCTION public.lv2_guard_field_removal()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE o jsonb; n jsonb;
BEGIN
  FOR o IN SELECT * FROM jsonb_array_elements(OLD.fields) LOOP
    n := NULL;
    SELECT e INTO n FROM jsonb_array_elements(NEW.fields) e WHERE e->>'key' = o->>'key';
    IF EXISTS (SELECT 1 FROM public.custom_list_item_owner_values v
                WHERE v.list_id = OLD.list_id AND v."values" ? (o->>'key')
                  AND (n IS NULL OR NOT public.lv2_value_fits(n, v."values" -> (o->>'key')))) THEN
      RAISE EXCEPTION 'field % still has saved values; delete it with delete_custom_list_field', o->>'key'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lv2_guard_field_removal ON public.custom_list_owner_settings;
CREATE TRIGGER lv2_guard_field_removal BEFORE UPDATE ON public.custom_list_owner_settings
  FOR EACH ROW EXECUTE FUNCTION public.lv2_guard_field_removal();

-- ---------------------------------------------------------------------
-- 4. Row-level security: owner only, on every operation
-- ---------------------------------------------------------------------

ALTER TABLE public.custom_list_owner_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_list_owner_settings    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.custom_list_item_owner_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_list_item_owner_values FORCE ROW LEVEL SECURITY;

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

REVOKE ALL ON public.custom_list_owner_settings, public.custom_list_item_owner_values FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_list_owner_settings, public.custom_list_item_owner_values TO authenticated;
-- Not added to supabase_realtime: nothing broadcasts these rows.

-- ---------------------------------------------------------------------
-- 5. Functions (invoker rights: they can do nothing the caller's own
--    row-level security does not already allow)
-- ---------------------------------------------------------------------

-- How many of this list's items have a value for the field: the number the
-- app shows before a permanent delete.
CREATE OR REPLACE FUNCTION public.count_custom_list_field_values(p_list_id uuid, p_key text)
RETURNS integer LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT count(*)::integer FROM public.custom_list_item_owner_values
   WHERE list_id = p_list_id AND "values" ? p_key
$$;

-- Permanent delete of one field (decision O1): refused unless the caller's
-- confirmed count still matches; then the values and the definition go
-- together, in one transaction.
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
     SET fields = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(v_fields) e WHERE e->>'key' <> p_key), '[]'::jsonb)
   WHERE list_id = p_list_id;
  RETURN v_count;
END $$;

-- The owner's own export (decision O3): their definitions and values.
-- Public, shared and anonymous exports never call this.
CREATE OR REPLACE FUNCTION public.export_my_list_owner_data()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'settings', COALESCE((SELECT jsonb_agg(to_jsonb(s) - 'user_id' ORDER BY s.list_id) FROM public.custom_list_owner_settings s WHERE s.user_id = auth.uid()), '[]'::jsonb),
    'values',   COALESCE((SELECT jsonb_agg(to_jsonb(v) - 'user_id' ORDER BY v.item_id) FROM public.custom_list_item_owner_values v WHERE v.user_id = auth.uid()), '[]'::jsonb))
$$;

REVOKE ALL ON FUNCTION public.count_custom_list_field_values(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_custom_list_field(uuid, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.export_my_list_owner_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_custom_list_field_values(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_custom_list_field(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_list_owner_data() TO authenticated;
