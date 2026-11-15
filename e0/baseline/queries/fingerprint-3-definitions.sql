-- READ ONLY

WITH objs(category, key, def) AS (
  SELECT 'table', c.relname, 'rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  UNION ALL
  SELECT 'column', table_name || '.' || column_name,
         data_type || '|' || coalesce(udt_name, '') || '|' || is_nullable || '|' || coalesce(column_default, '')
    FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL
  SELECT 'constraint', conrelid::regclass::text || '.' || conname, pg_get_constraintdef(oid)
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid <> 0 AND contype <> 'n'
  UNION ALL
  SELECT 'index', indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL
  SELECT 'policy', schemaname || '.' || tablename || '.' || policyname,
         permissive || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
    FROM pg_policies WHERE schemaname IN ('public', 'storage')
  UNION ALL
  SELECT 'function', p.oid::regprocedure::text,
         pg_get_function_result(p.oid) || '|secdef=' || p.prosecdef || '|' || p.provolatile::text || '|' ||
         coalesce(array_to_string(p.proconfig, ','), '') || '|' || md5(p.prosrc)
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'trigger', t.tgrelid::regclass::text || '.' || t.tgname, pg_get_triggerdef(t.oid)
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE NOT t.tgisinternal AND (c.relnamespace = 'public'::regnamespace OR t.tgrelid = 'auth.users'::regclass)
  UNION ALL
  SELECT 'view', viewname, md5(definition) FROM pg_views WHERE schemaname = 'public'
  UNION ALL
  SELECT 'table_grant', table_name || '.' || grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
   GROUP BY table_name, grantee
  UNION ALL
  SELECT 'function_grant', p.oid::regprocedure::text || '.' || r.rolname,
         CASE WHEN has_function_privilege(r.oid, p.oid, 'EXECUTE') THEN 'execute' ELSE 'none' END
    FROM pg_proc p CROSS JOIN pg_roles r
   WHERE p.pronamespace = 'public'::regnamespace AND r.rolname IN ('anon', 'authenticated')
  UNION ALL
  SELECT 'bucket', id, public::text || '|' || coalesce(file_size_limit::text, '') || '|' || coalesce(array_to_string(allowed_mime_types, ','), '')
    FROM storage.buckets
  UNION ALL
  SELECT 'cron_job', jobname, schedule || '|' || md5(command) FROM cron.job
)
SELECT category, key, def
  FROM objs WHERE category = 'policy' AND key IN ('public.custom_list_types.Users can insert their own list types')   -- edit
 ORDER BY key;
