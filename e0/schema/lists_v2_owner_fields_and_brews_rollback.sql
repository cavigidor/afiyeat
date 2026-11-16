-- Rollback for lists_v2_owner_fields_and_brews.sql - PROPOSAL, NOT APPLIED.
-- Removes only what the proposal added. Existing tables, columns, policies
-- and data are untouched because the proposal never changed them.
-- Data in the three new tables is lost on rollback: before running it,
-- each affected owner (or the operator, with approval) should keep
-- export_my_list_owner_data(). Old app builds never read these tables, so
-- they are unaffected either way.
BEGIN;
DROP TABLE IF EXISTS public.custom_list_item_brews;
DROP TABLE IF EXISTS public.custom_list_item_owner_values;
DROP TABLE IF EXISTS public.custom_list_owner_settings;
DROP FUNCTION IF EXISTS public.export_my_list_owner_data();
DROP FUNCTION IF EXISTS public.delete_custom_list_field(uuid, text, integer);
DROP FUNCTION IF EXISTS public.count_custom_list_field_values(uuid, text);
DROP FUNCTION IF EXISTS public.lv2_touch_brew();
DROP FUNCTION IF EXISTS public.lv2_guard_field_removal();
DROP FUNCTION IF EXISTS public.lv2_check_owner_values();
DROP FUNCTION IF EXISTS public.lv2_owns_list(uuid);
DROP FUNCTION IF EXISTS public.lv2_value_fits(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.lv2_values_ok(jsonb);
DROP FUNCTION IF EXISTS public.lv2_date_ok(text);
DROP FUNCTION IF EXISTS public.lv2_layout_ok(jsonb);
DROP FUNCTION IF EXISTS public.lv2_fields_ok(jsonb);
DROP FUNCTION IF EXISTS public.lv2_field_key_ok(text);
COMMIT;
