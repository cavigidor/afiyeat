-- READ ONLY. A fingerprint of every security rule, function, grant and trigger the five Lists V2
-- migrations touch. Run it BEFORE migrating and save the result. If you ever apply the rollback,
-- run it again afterwards: the "overall" digest (and every row) must be identical to the saved one.
-- (post-migration-checks.sql is not the right test after a rollback: the rollback deliberately keeps
-- the new columns and discovery tokens, so some of those checks stay true.)
WITH items AS (
  -- security rules on the affected tables, and the custom-list-images storage rules
  SELECT 'policy' AS kind,
         schemaname || '.' || tablename || ' / ' || policyname AS name,
         md5(concat_ws('|', permissive, cmd, roles::text, qual, with_check)) AS digest
  FROM pg_policies
  WHERE (schemaname = 'public' AND tablename IN ('custom_lists', 'custom_list_items', 'custom_list_types',
           'custom_list_statuses', 'custom_list_item_images', 'content_reports', 'restaurant_images'))
     OR (schemaname = 'storage' AND tablename = 'objects'
         AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%custom-list-images%')
  UNION ALL
  -- functions the migrations replace or add: definition and grants
  SELECT 'function', p.oid::regprocedure::text,
         md5(pg_get_functiondef(p.oid) || '|' || coalesce(p.proacl::text, 'default-grants'))
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('get_explore_lists', 'get_shared_preview', 'can_view_custom_list', 'custom_list_anonymous_view',
                      'custom_lists_discovery_token', 'get_discoverable_list', 'get_list_discovery_preview',
                      'report_discoverable_list', 'get_discovery_places')
  UNION ALL
  -- triggers on custom_lists (the migrations add the discovery-token trigger)
  SELECT 'trigger', tgrelid::regclass::text || ' / ' || tgname, md5(pg_get_triggerdef(oid))
  FROM pg_trigger
  WHERE NOT tgisinternal AND tgrelid = 'public.custom_lists'::regclass
)
SELECT kind, name, digest FROM (
  SELECT 0 AS o, 'overall' AS kind, count(*)::text || ' items' AS name,
         md5(string_agg(kind || ':' || name || ':' || digest, ',' ORDER BY kind, name)) AS digest
  FROM items
  UNION ALL
  SELECT 1, kind, name, digest FROM items
) f
ORDER BY o, kind, name;
