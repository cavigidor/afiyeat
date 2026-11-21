-- RECOVERY THAT KEEPS EVERYONE'S DETAILS. Use this, not the rollback, if item details must be switched off
-- after people have started saving them.
--
-- Moves both tables, with every row, into a private schema (lv2_parked) that no app role can reach, and
-- stops signed-in users calling the three functions. The app then sees "table not found" and behaves
-- exactly as it did before item details existed (lists, items, notes, photos, ratings, statuses untouched).
-- Nothing is deleted: deleting an item or list still removes its parked details through the foreign keys.
-- Undo with lists_v2_owner_fields_unpark.sql. Safe to run twice.
BEGIN;
CREATE SCHEMA IF NOT EXISTS lv2_parked;
REVOKE ALL ON SCHEMA lv2_parked FROM PUBLIC, anon, authenticated;
DO $park$
BEGIN
  IF to_regclass('public.custom_list_item_owner_values') IS NOT NULL THEN
    ALTER TABLE public.custom_list_item_owner_values SET SCHEMA lv2_parked;
  END IF;
  IF to_regclass('public.custom_list_owner_settings') IS NOT NULL THEN
    ALTER TABLE public.custom_list_owner_settings SET SCHEMA lv2_parked;
  END IF;
END $park$;
REVOKE EXECUTE ON FUNCTION public.count_custom_list_field_values(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_custom_list_field(uuid, text, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.export_my_list_owner_data() FROM authenticated;
-- Tell PostgREST (the app's API) to re-read the schema now rather than on its next refresh.
NOTIFY pgrst, 'reload schema';
COMMIT;
