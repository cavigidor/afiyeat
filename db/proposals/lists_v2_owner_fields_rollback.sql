-- Rollback for lists_v2_owner_fields.sql - FOR ISOLATED TESTING, NOT APPLIED IN PRODUCTION.
-- Removes only what that file added. Existing tables, columns, policies and data are untouched
-- because it never changed them. Values in the two new tables are lost on rollback: keep each
-- owner's export_my_list_owner_data() first. Older app builds never read these tables.
BEGIN;
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
