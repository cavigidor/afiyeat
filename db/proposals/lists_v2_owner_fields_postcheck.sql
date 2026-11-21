-- READ ONLY. Run in production right AFTER applying lists_v2_owner_fields.sql. Every `ok` must be true,
-- and `applied exactly` compares the stored function and policy text with the lab's (a pasted copy that
-- lost or gained characters, line breaks included, shows up here).
WITH fn AS (
  SELECT p.proname, p.prosrc, p.proacl::text AS acl, p.prosecdef
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND (p.proname LIKE 'lv2\_%' OR p.proname IN ('count_custom_list_field_values', 'delete_custom_list_field', 'export_my_list_owner_data'))
), pol AS (
  SELECT tablename, policyname, cmd, roles::text AS roles, qual, with_check
  FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('custom_list_owner_settings', 'custom_list_item_owner_values')
)
SELECT check_name, ok FROM (VALUES
  (1, 'both tables exist in public, with row-level security enabled and forced',
      (SELECT count(*) = 2 FROM pg_class c WHERE c.oid IN (to_regclass('public.custom_list_owner_settings'), to_regclass('public.custom_list_item_owner_values'))
         AND c.relrowsecurity AND c.relforcerowsecurity)),
  (2, 'exactly one policy per table: ALL, for authenticated, owner-checked',
      (SELECT count(*) = 2 FROM pol WHERE cmd = 'ALL' AND roles = '{authenticated}' AND qual LIKE '%auth.uid()%' AND qual LIKE '%lv2_owns_list%' AND with_check = qual)
      AND (SELECT count(*) = 2 FROM pol)),
  (3, 'signed-out visitors (anon) have no access to either table',
      NOT has_table_privilege('anon', 'public.custom_list_owner_settings', 'SELECT') AND NOT has_table_privilege('anon', 'public.custom_list_item_owner_values', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.custom_list_item_owner_values', 'INSERT')),
  (4, 'signed-in users can use the tables (their own rows only, by policy)',
      has_table_privilege('authenticated', 'public.custom_list_owner_settings', 'SELECT, INSERT, UPDATE, DELETE')
      AND has_table_privilege('authenticated', 'public.custom_list_item_owner_values', 'SELECT, INSERT, UPDATE, DELETE')),
  (5, 'the three functions exist, run with the caller''s rights, and anon cannot call them',
      (SELECT count(*) = 3 FROM fn WHERE proname IN ('count_custom_list_field_values', 'delete_custom_list_field', 'export_my_list_owner_data') AND NOT prosecdef)
      AND NOT has_function_privilege('anon', 'public.export_my_list_owner_data()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.delete_custom_list_field(uuid,text,integer)', 'EXECUTE')),
  (6, 'both integrity triggers are in place',
      (SELECT count(*) = 2 FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('lv2_check_owner_values', 'lv2_guard_field_removal'))),
  (7, 'neither table is broadcast by Realtime',
      NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE tablename IN ('custom_list_owner_settings', 'custom_list_item_owner_values'))),
  (8, 'both tables start empty',
      NOT EXISTS (SELECT 1 FROM public.custom_list_owner_settings) AND NOT EXISTS (SELECT 1 FROM public.custom_list_item_owner_values)),
  (9, 'applied exactly: function and policy text match the lab (digest 4816778c)',
      left(md5((SELECT string_agg(proname || ':' || md5(prosrc), ',' ORDER BY proname) FROM fn)
        || '|' || (SELECT string_agg(policyname || ':' || md5(coalesce(qual, '') || '/' || coalesce(with_check, '')), ',' ORDER BY policyname) FROM pol)), 8) = '4816778c')
) AS t(n, check_name, ok)
ORDER BY n;
