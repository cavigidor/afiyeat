-- FULL REMOVAL of lists_v2_owner_fields.sql. Not applied in production. DESTRUCTIVE once people have saved
-- details: dropping the tables deletes every saved field definition and value. To switch item details off
-- while keeping them, use lists_v2_owner_fields_park.sql instead.
--
-- Refuses to run while either table holds rows, unless the session confirms that a backup of those rows
-- exists (a Lovable "Export project data" taken after the last save, kept off-platform):
--   SET lv2.confirm_delete_saved_details = 'backup-taken';
-- Existing tables, columns, policies and data are untouched: the proposal never changed them. Older app
-- builds never read these tables.
BEGIN;
DO $guard$
DECLARE n bigint := 0;
BEGIN
  IF to_regclass('public.custom_list_owner_settings') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.custom_list_owner_settings' INTO n;
  END IF;
  IF to_regclass('public.custom_list_item_owner_values') IS NOT NULL THEN
    n := n + (SELECT count(*) FROM public.custom_list_item_owner_values);
  END IF;
  IF n > 0 AND coalesce(current_setting('lv2.confirm_delete_saved_details', true), '') <> 'backup-taken' THEN
    RAISE EXCEPTION 'refusing to delete % saved item-detail rows: park them instead (lists_v2_owner_fields_park.sql), or confirm a backup first', n;
  END IF;
END $guard$;
DROP TABLE IF EXISTS public.custom_list_item_owner_values;
DROP TABLE IF EXISTS public.custom_list_owner_settings;
DROP FUNCTION IF EXISTS public.export_my_list_owner_data();
DROP FUNCTION IF EXISTS public.delete_custom_list_field(uuid, text, integer);
DROP FUNCTION IF EXISTS public.count_custom_list_field_values(uuid, text);
DROP FUNCTION IF EXISTS public.lv2_guard_field_removal();
DROP FUNCTION IF EXISTS public.lv2_check_owner_values();
DROP FUNCTION IF EXISTS public.lv2_owns_list(uuid);
DROP FUNCTION IF EXISTS public.lv2_value_fits(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.lv2_values_ok(jsonb);
DROP FUNCTION IF EXISTS public.lv2_date_ok(text);
DROP FUNCTION IF EXISTS public.lv2_fields_ok(jsonb);
DROP FUNCTION IF EXISTS public.lv2_options_ok(jsonb);
DROP FUNCTION IF EXISTS public.lv2_field_key_ok(text);
COMMIT;
