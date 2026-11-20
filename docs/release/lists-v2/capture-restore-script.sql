-- READ ONLY. Run in production BEFORE applying the five Lists V2 migrations.
-- It changes nothing. It returns one row with three columns:
--   restore_sql  a ready-to-run SQL script that puts back exactly today's security rules and
--                functions that the five migrations replace; save it as restore-<date>.sql on your Mac
--   characters   the script's exact length
--   md5          the script's checksum
-- The script's last line is "-- END OF LISTS V2 ROLLBACK". Check the saved file is complete before
-- migrating (RELEASE_RUNBOOK.md, step 1.4): a chat window can silently cut a long value short.
--
-- Scope = everything the five migrations replace or add:
--   policies on custom_lists, custom_list_items, custom_list_types, custom_list_statuses,
--   custom_list_item_images, content_reports, restaurant_images, and the custom-list-images
--   policies on storage.objects; the functions get_explore_lists, get_shared_preview and the
--   new discovery functions; the discovery-token trigger.
-- The new columns (custom_lists.visibility, custom_lists.discovery_token,
-- content_reports.via_anonymous) are deliberately KEPT by the restore: the current app ignores
-- them, and dropping them would throw away settings people made in Lists V2.
WITH
script AS (
WITH
tabs(schemaname, tablename) AS (VALUES
  ('public', 'custom_lists'), ('public', 'custom_list_items'), ('public', 'custom_list_types'),
  ('public', 'custom_list_statuses'), ('public', 'custom_list_item_images'),
  ('public', 'content_reports'), ('public', 'restaurant_images')),
pol AS (
  SELECT p.* FROM pg_policies p
  WHERE (p.schemaname, p.tablename) IN (SELECT * FROM tabs)
     OR (p.schemaname = 'storage' AND p.tablename = 'objects'
         AND (coalesce(p.qual, '') || coalesce(p.with_check, '')) LIKE '%custom-list-images%')),
-- functions the migrations replace (today's versions are restored) ...
old_fn AS (
  SELECT p.oid FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('get_explore_lists', 'get_shared_preview')),
-- ... and functions the migrations add (dropped by the restore unless they already exist today)
new_fn(name) AS (VALUES ('can_view_custom_list'), ('custom_list_anonymous_view'), ('custom_lists_discovery_token'),
  ('get_discoverable_list'), ('get_list_discovery_preview'), ('report_discoverable_list'), ('get_discovery_places')),
existing_new AS (SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (SELECT name FROM new_fn))
SELECT concat_ws(E'\n',
  '-- Lists V2 rollback, generated ' || now()::text || ' from the database it will be run on.',
  '-- Puts back the security rules and functions exactly as they were when this was generated.',
  'BEGIN;',
  -- 1. policies: drop everything on the scoped tables (and the custom-list-images storage rules), then recreate today's
  $$DO $do$ DECLARE r record; BEGIN
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE (schemaname = 'public' AND tablename IN ('custom_lists','custom_list_items','custom_list_types','custom_list_statuses','custom_list_item_images','content_reports','restaurant_images'))
       OR (schemaname = 'storage' AND tablename = 'objects' AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%custom-list-images%')
  LOOP EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename); END LOOP;
END $do$;$$,
  (SELECT string_agg(format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;',
      policyname, schemaname, tablename, permissive, cmd,
      (SELECT string_agg(CASE WHEN r = 'public' THEN 'public' ELSE quote_ident(r) END, ', ') FROM unnest(roles) r),
      CASE WHEN qual IS NOT NULL THEN ' USING (' || qual || ')' ELSE '' END,
      CASE WHEN with_check IS NOT NULL THEN ' WITH CHECK (' || with_check || ')' ELSE '' END), E'\n' ORDER BY schemaname, tablename, policyname) FROM pol),
  -- 2. discovery-token trigger and the functions the migrations add
  'DROP TRIGGER IF EXISTS custom_lists_discovery_token ON public.custom_lists;',
  -- (signatures of the added functions are only known after migrating, so they are dropped by name)
  $$DO $do$ DECLARE r record; BEGIN
  FOR r IN SELECT p.oid::regprocedure AS f, p.proname FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('can_view_custom_list','custom_list_anonymous_view','custom_lists_discovery_token','get_discoverable_list','get_list_discovery_preview','report_discoverable_list','get_discovery_places','get_explore_lists')
  LOOP EXECUTE format('DROP FUNCTION %s', r.f); END LOOP;
END $do$;$$,
  CASE WHEN (SELECT count(*) FROM existing_new) > 0 THEN '-- NOTE: these were already present before migrating and are recreated below: ' || (SELECT string_agg(proname, ', ') FROM existing_new) END,
  -- 3. today's versions of the replaced functions (and any "new" one that already existed), with exactly
  --    today's grants (default privileges would otherwise hand new functions to anon)
  (SELECT string_agg(pg_get_functiondef(p.oid) || ';' || E'\n' ||
      format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role;', p.oid::regprocedure) || E'\n' ||
      coalesce((SELECT string_agg(format('GRANT EXECUTE ON FUNCTION %s TO %s;', p.oid::regprocedure,
                  CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END), E'\n')
                FROM aclexplode(p.proacl) a WHERE a.privilege_type = 'EXECUTE'),
               format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC;', p.oid::regprocedure)), E'\n')
     FROM pg_proc p
     WHERE p.oid IN (SELECT oid FROM old_fn)
        OR (p.pronamespace = 'public'::regnamespace AND p.proname IN (SELECT proname FROM existing_new))),
  'COMMIT;',
  '-- END OF LISTS V2 ROLLBACK'
) AS restore_sql
)
SELECT restore_sql, length(restore_sql) AS characters, md5(restore_sql) AS md5 FROM script;
