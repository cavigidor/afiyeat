-- READ ONLY

WITH pol AS MATERIALIZED (
  SELECT schemaname::text AS s, tablename::text AS t, policyname::text AS name,
         permissive || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') AS def,
         cmd::text AS cmd
    FROM pg_policies WHERE schemaname IN ('public', 'storage', 'realtime')
),
-- Column types of a UNION come from its first branch: category, key and def are cast to text there, so no
-- key is cut to the 63-byte "name" type (version 1 of this query truncated long keys that way).
objs(category, key, def) AS (
  SELECT 'table'::text, c.relname::text,
         'kind=' || c.relkind::text || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity ||
         ' force=' || c.relforcerowsecurity || ' options=' || coalesce(array_to_string(c.reloptions, ','), '')::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  UNION ALL
  SELECT 'column', c.relname || '.' || a.attname,
         format_type(a.atttypid, a.atttypmod) || '|notnull=' || a.attnotnull || '|identity=' || a.attidentity::text ||
         '|generated=' || a.attgenerated::text || '|collation=' || coalesce(co.collname::text, '') ||
         '|default=' || coalesce(pg_get_expr(ad.adbin, ad.adrelid), '')
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    LEFT JOIN pg_collation co ON co.oid = a.attcollation AND a.attcollation <> 0
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm') AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'column_acl', c.relname || '.' || a.attname || '.' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee)::text END,
         string_agg(x.privilege_type || CASE WHEN x.is_grantable THEN '*' ELSE '' END, ',' ORDER BY x.privilege_type)
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(a.attacl) x
   WHERE n.nspname = 'public' AND a.attacl IS NOT NULL AND a.attnum > 0 AND NOT a.attisdropped
   GROUP BY c.relname, a.attname, x.grantee
  UNION ALL
  SELECT 'constraint', conrelid::regclass::text || '.' || conname, contype::text || '|' || pg_get_constraintdef(oid)
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid <> 0 AND contype <> 'n'
  UNION ALL
  SELECT 'index', indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL
  SELECT 'policy', s || '.' || t || '.' || name, def FROM pol
  UNION ALL
  -- Every policy that applies to a command, names ignored: adding, removing or changing any of them changes this row.
  SELECT 'effective_policy', n.nspname || '.' || c.relname || '.' || cmd.c,
         'rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity || E'\n' ||
         coalesce(string_agg(p.def, E'\n' ORDER BY p.def COLLATE "C"), '')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS cmd(c)
    LEFT JOIN pol p ON p.s = n.nspname AND p.t = c.relname AND (p.cmd = cmd.c OR p.cmd = 'ALL')
   WHERE n.nspname IN ('public', 'storage', 'realtime') AND c.relkind IN ('r', 'p')
   GROUP BY n.nspname, c.relname, cmd.c, c.relrowsecurity, c.relforcerowsecurity
  UNION ALL
  SELECT 'function', p.oid::regprocedure::text,
         pg_get_function_result(p.oid) || '|lang=' || l.lanname || '|secdef=' || p.prosecdef || '|vol=' || p.provolatile::text ||
         '|strict=' || p.proisstrict || '|leakproof=' || p.proleakproof || '|config=' || coalesce(array_to_string(p.proconfig, ','), '') ||
         '|owner=' || pg_get_userbyid(p.proowner) || '|body=' || md5(coalesce(p.prosrc, ''))
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.pronamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'function_acl', p.oid::regprocedure::text || '.' || g.name,
         CASE WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                            WHERE x.privilege_type = 'EXECUTE'
                              AND CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee)::text END = g.name) THEN 'EXECUTE' ELSE 'none' END
    FROM pg_proc p CROSS JOIN (VALUES ('PUBLIC'), ('anon'), ('authenticated'), ('service_role')) AS g(name)
   WHERE p.pronamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'trigger', t.tgrelid::regclass::text || '.' || t.tgname, 'enabled=' || t.tgenabled::text || '|' || pg_get_triggerdef(t.oid)
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE NOT t.tgisinternal AND (c.relnamespace = 'public'::regnamespace OR t.tgrelid = to_regclass('auth.users'))
  UNION ALL
  SELECT 'view', c.relname,
         'kind=' || c.relkind::text || ' owner=' || pg_get_userbyid(c.relowner) || ' options=' || coalesce(array_to_string(c.reloptions, ','), '') ||
         ' def=' || md5(pg_get_viewdef(c.oid))
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm')
  UNION ALL
  SELECT 'table_acl', n.nspname || '.' || c.relname || '.' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee)::text END,
         string_agg(x.privilege_type || CASE WHEN x.is_grantable THEN '*' ELSE '' END, ',' ORDER BY x.privilege_type)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
   WHERE n.nspname IN ('public', 'storage', 'realtime') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee)::text END IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
   GROUP BY n.nspname, c.relname, x.grantee
  UNION ALL
  SELECT 'sequence_acl', c.relname || '.' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee)::text END,
         string_agg(x.privilege_type, ',' ORDER BY x.privilege_type)
    FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) x
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S' AND CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee)::text END IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
   GROUP BY c.relname, x.grantee
  UNION ALL
  SELECT 'schema_acl', n.nspname || '.' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee)::text END,
         string_agg(x.privilege_type, ',' ORDER BY x.privilege_type)
    FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) x
   WHERE n.nspname IN ('public', 'storage', 'auth', 'extensions', 'cron', 'net', 'realtime', 'vault')
     AND CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee)::text END IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
   GROUP BY n.nspname, x.grantee
  UNION ALL
  SELECT 'default_acl', pg_get_userbyid(d.defaclrole) || '.' || coalesce(d.defaclnamespace::regnamespace::text, '*') || '.' || d.defaclobjtype::text,
         array_to_string(ARRAY(SELECT a::text FROM unnest(d.defaclacl) a ORDER BY 1), ',')
    FROM pg_default_acl d
  UNION ALL
  SELECT 'role', r.rolname, 'super=' || r.rolsuper || ' bypassrls=' || r.rolbypassrls || ' inherit=' || r.rolinherit || ' login=' || r.rolcanlogin
    FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'authenticator')
  UNION ALL
  SELECT 'extension', e.extname, e.extversion || '|' || e.extnamespace::regnamespace::text FROM pg_extension e
  UNION ALL
  SELECT 'publication', p.pubname,
         'all=' || p.puballtables || ' ins=' || p.pubinsert || ' upd=' || p.pubupdate || ' del=' || p.pubdelete ||
         ' trunc=' || p.pubtruncate || ' viaroot=' || coalesce((to_jsonb(p) ->> 'pubviaroot'), '?')
    FROM pg_publication p
  UNION ALL
  SELECT 'publication_table', t.pubname || '.' || t.schemaname || '.' || t.tablename,
         'columns=' || coalesce(to_jsonb(t) ->> 'attnames', '?') || ' filter=' || coalesce(to_jsonb(t) ->> 'rowfilter', '')
    FROM pg_publication_tables t
  UNION ALL
  SELECT 'bucket', b.id, 'public=' || coalesce(b.public::text, '') || ' limit=' || coalesce(b.file_size_limit::text, '') ||
         ' mime=' || coalesce(array_to_string(b.allowed_mime_types, ','), '')
    FROM storage.buckets b
  UNION ALL
  SELECT 'cron_job', coalesce(to_jsonb(j) ->> 'jobname', 'job-' || (to_jsonb(j) ->> 'jobid')),
         coalesce(to_jsonb(j) ->> 'schedule', '') || '|active=' || coalesce(to_jsonb(j) ->> 'active', '?') ||
         '|db=' || coalesce(to_jsonb(j) ->> 'database', '?') || '|command=' || md5(coalesce(to_jsonb(j) ->> 'command', ''))
    FROM cron.job j
)
SELECT category, key, def
  FROM objs WHERE (category, key) IN (('function', 'notify_user(uuid,text,text,text,jsonb)'))   -- edit
 ORDER BY category, key;
