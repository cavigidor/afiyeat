-- Undo lists_v2_owner_fields_park.sql: the two tables, with every row, back where the app reads them, and
-- the three functions callable by signed-in users again. Row-level security, policies, grants and triggers
-- travel with the tables, so they are exactly as before parking. Safe to run twice.
BEGIN;
DO $unpark$
BEGIN
  IF to_regclass('lv2_parked.custom_list_owner_settings') IS NOT NULL THEN
    ALTER TABLE lv2_parked.custom_list_owner_settings SET SCHEMA public;
  END IF;
  IF to_regclass('lv2_parked.custom_list_item_owner_values') IS NOT NULL THEN
    ALTER TABLE lv2_parked.custom_list_item_owner_values SET SCHEMA public;
  END IF;
END $unpark$;
GRANT EXECUTE ON FUNCTION public.count_custom_list_field_values(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_custom_list_field(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_list_owner_data() TO authenticated;
-- Tell PostgREST (the app's API) to re-read the schema now rather than on its next refresh.
NOTIFY pgrst, 'reload schema';
COMMIT;
