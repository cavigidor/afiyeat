-- READ ONLY. Run in production BEFORE applying lists_v2_owner_fields.sql. Every `ok` must be true.
-- It only reads the catalog: no table data, no changes.
SELECT check_name, ok FROM (VALUES
  (1, 'new tables do not exist yet (public or parked)',
      to_regclass('public.custom_list_owner_settings') IS NULL AND to_regclass('public.custom_list_item_owner_values') IS NULL
      AND to_regclass('lv2_parked.custom_list_owner_settings') IS NULL AND to_regclass('lv2_parked.custom_list_item_owner_values') IS NULL),
  (2, 'none of the new functions exist yet',
      NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'lv2\_%'
        OR p.proname IN ('count_custom_list_field_values', 'delete_custom_list_field', 'export_my_list_owner_data')))),
  (3, 'custom_lists.id and custom_list_items.id are uuid primary keys',
      (SELECT count(*) = 2 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indisprimary AND i.indrelid IN ('public.custom_lists'::regclass, 'public.custom_list_items'::regclass)
          AND a.attname = 'id' AND a.atttypid = 'uuid'::regtype)),
  (4, 'custom_list_items has list_id (uuid) and custom_lists has user_id (uuid)',
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'custom_list_items' AND column_name = 'list_id' AND data_type = 'uuid')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'custom_lists' AND column_name = 'user_id' AND data_type = 'uuid')),
  (5, 'auth.uid() and the anon / authenticated roles exist',
      to_regprocedure('auth.uid()') IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')),
  (6, 'the five Lists V2 migrations are in place (visibility column, discovery functions)',
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'custom_lists' AND column_name = 'visibility')
      AND to_regprocedure('public.can_view_custom_list(uuid,uuid)') IS NOT NULL AND to_regprocedure('public.get_discovery_places(text)') IS NOT NULL)
) AS t(n, check_name, ok)
ORDER BY n;
