// Schema fingerprint, version 2. ONE definition, used three ways:
//   - written out as a read-only query (queries/fingerprint-export.sql) that returns ONE json value,
//     to be run in production by an authorised Lovable operator and in the isolated project;
//   - run in-process against reconstructed states (detect-stack.mjs, build-baseline.mjs);
//   - validated and compared by compare.mjs / lib/fingerprint-file.mjs.
//
// Each row is {c: category, k: key, h: md5(definition), d?: definition}. Catalog definitions only:
// no table data, no user identifiers, no secrets (cron commands and function bodies appear only as md5).
//
// COVERAGE is the complete list of what a matching fingerprint can speak for. Anything not listed
// is NOT covered, however well the hashes match (see NOT_COVERED).

export const FINGERPRINT_FORMAT = 'afiyeat-schema-fingerprint';
export const FINGERPRINT_VERSION = 2;

export const COVERAGE = {
  table: 'public tables: kind, owner, RLS enabled/forced, reloptions',
  column: 'public tables, views and materialized views: complete type (format_type incl. typmod), not null, identity, generated, collation, default expression',
  column_acl: 'explicit column-level privileges on public relations, per grantee (PUBLIC included)',
  constraint: 'public constraints except NOT NULL (covered by column): full definition',
  index: 'public indexes: full definition',
  policy: 'policies on public, storage and realtime tables: permissive/restrictive, command, roles, USING, WITH CHECK',
  effective_policy: 'per table and command (SELECT/INSERT/UPDATE/DELETE) in public, storage, realtime: RLS flags plus the complete set of applicable policies, ignoring names',
  function: 'public functions: signature, result, language, SECURITY DEFINER, volatility, strict, leakproof, config (search_path), owner, md5 of body',
  function_acl: 'EXECUTE on every public function for PUBLIC, anon, authenticated, service_role (defaults resolved)',
  trigger: 'non-internal triggers on public tables and auth.users: full definition, enabled state',
  view: 'public views and materialized views: owner, reloptions (security_invoker, security_barrier), md5 of definition',
  table_acl: 'privileges on public, storage and realtime relations per grantee, PUBLIC included (defaults resolved)',
  sequence_acl: 'privileges on public sequences per grantee (defaults resolved)',
  schema_acl: 'USAGE/CREATE on schemas public, storage, auth, extensions, cron, net, realtime, vault per grantee',
  default_acl: 'ALTER DEFAULT PRIVILEGES entries',
  role: 'anon, authenticated, service_role, authenticator: superuser, bypassrls, inherit, login',
  extension: 'installed extensions: version and schema',
  publication: 'publications: all-tables flag, published operations, via-root',
  publication_table: 'tables in each publication, with published columns and row filter',
  bucket: 'storage buckets: public flag, size limit, allowed MIME types',
  cron_job: 'pg_cron jobs: schedule, active flag, database, md5 of command',
};

export const NOT_COVERED = [
  'table data, row counts, storage objects and files',
  'Edge Functions, their code and their secrets; Vault contents; API keys',
  'Supabase Auth configuration (providers, redirect URLs, email templates, rate limits)',
  'Realtime server configuration beyond publication membership and realtime-schema policies',
  'pg_net queue contents and outbound requests already made',
  'objects in schemas other than those named above (for example auth tables other than triggers on auth.users)',
  'comments, statistics, ownership of objects not listed, role memberships and passwords',
  'behaviour: a matching definition does not prove the app, the API or Auth behave the same',
  'definitions are compared as Postgres prints them; a different Postgres version can print an identical object differently (a false mismatch, which fails safe)',
];

// Categories whose definition is short and useful to read: exported in full (d) as well as hashed.
// cron_job is safe in full: its definition holds the command only as an md5.
export const FULL_TEXT = new Set(['table', 'column', 'column_acl', 'constraint', 'index', 'policy', 'effective_policy',
  'function_acl', 'trigger', 'table_acl', 'sequence_acl', 'schema_acl', 'default_acl', 'role', 'extension',
  'publication', 'publication_table', 'bucket', 'cron_job']);

const ACL_GRANTEES = `('PUBLIC', 'anon', 'authenticated', 'service_role')`;
const POLICY_SCHEMAS = `('public', 'storage', 'realtime')`;

// grantee name for an aclexplode row: 0 means PUBLIC
const granteeName = (col) => `CASE WHEN ${col} = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(${col})::text END`;

export const FINGERPRINT_CTE = `
WITH pol AS MATERIALIZED (
  SELECT schemaname::text AS s, tablename::text AS t, policyname::text AS name,
         permissive || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') AS def,
         cmd::text AS cmd
    FROM pg_policies WHERE schemaname IN ${POLICY_SCHEMAS}
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
  SELECT 'column_acl', c.relname || '.' || a.attname || '.' || ${granteeName('x.grantee')},
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
         'rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity || E'\\n' ||
         coalesce(string_agg(p.def, E'\\n' ORDER BY p.def COLLATE "C"), '')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS cmd(c)
    LEFT JOIN pol p ON p.s = n.nspname AND p.t = c.relname AND (p.cmd = cmd.c OR p.cmd = 'ALL')
   WHERE n.nspname IN ${POLICY_SCHEMAS} AND c.relkind IN ('r', 'p')
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
                              AND ${granteeName('x.grantee')} = g.name) THEN 'EXECUTE' ELSE 'none' END
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
  SELECT 'table_acl', n.nspname || '.' || c.relname || '.' || ${granteeName('x.grantee')},
         string_agg(x.privilege_type || CASE WHEN x.is_grantable THEN '*' ELSE '' END, ',' ORDER BY x.privilege_type)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
   WHERE n.nspname IN ${POLICY_SCHEMAS} AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND ${granteeName('x.grantee')} IN ${ACL_GRANTEES}
   GROUP BY n.nspname, c.relname, x.grantee
  UNION ALL
  SELECT 'sequence_acl', c.relname || '.' || ${granteeName('x.grantee')},
         string_agg(x.privilege_type, ',' ORDER BY x.privilege_type)
    FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) x
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S' AND ${granteeName('x.grantee')} IN ${ACL_GRANTEES}
   GROUP BY c.relname, x.grantee
  UNION ALL
  SELECT 'schema_acl', n.nspname || '.' || ${granteeName('x.grantee')},
         string_agg(x.privilege_type, ',' ORDER BY x.privilege_type)
    FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) x
   WHERE n.nspname IN ('public', 'storage', 'auth', 'extensions', 'cron', 'net', 'realtime', 'vault')
     AND ${granteeName('x.grantee')} IN ${ACL_GRANTEES}
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
)`;

const FULL_LIST = `ARRAY[${[...FULL_TEXT].map((c) => `'${c}'`).join(', ')}]`;
const COVERAGE_LIST = `ARRAY[${Object.keys(COVERAGE).map((c) => `'${c}'`).join(', ')}]`;

/**
 * The one production / isolated-project query. Read only. Returns a single json value to copy whole.
 * If a SQL runner cuts long values off, use parts: run part 1..N of the same N and save each value;
 * every part carries the checksum and row count of the WHOLE set, and compare/detect merge and check them.
 */
export function exportSql({ part = 1, parts = 1 } = {}) {
  if (!Number.isInteger(parts) || parts < 1 || parts > 20 || !Number.isInteger(part) || part < 1 || part > parts) throw new Error('bad part/parts');
  return `-- READ ONLY. Afiyeat schema fingerprint v${FINGERPRINT_VERSION}${parts > 1 ? `, part ${part} of ${parts}` : ''}. Returns ONE value: copy it whole.
-- Catalog definitions only: no table data, no user identifiers, no secrets.
${FINGERPRINT_CTE},
rws AS MATERIALIZED (
  SELECT category AS c, key AS k, md5(def) AS h, CASE WHEN category = ANY (${FULL_LIST}) THEN def END AS d,
         ntile(${parts}) OVER (ORDER BY category COLLATE "C", key COLLATE "C") AS part
    FROM objs
)
SELECT json_build_object(
  'format', '${FINGERPRINT_FORMAT}',
  'version', ${FINGERPRINT_VERSION},
  'coverage', ${COVERAGE_LIST},
  'server_version_num', current_setting('server_version_num')::int,
  'database', current_database(),
  'generated_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'part', ${part},
  'parts', ${parts},
  'row_count', (SELECT count(*) FROM rws),
  'checksum', (SELECT md5(coalesce(string_agg(c || E'\\t' || k || E'\\t' || h, E'\\n' ORDER BY c COLLATE "C", k COLLATE "C"), '')) FROM rws),
  'rows', (SELECT coalesce(json_agg(json_build_object('c', c, 'k', k, 'h', h, 'd', d) ORDER BY c COLLATE "C", k COLLATE "C"), '[]'::json)
             FROM rws WHERE part = ${part})
)::text AS fingerprint;`;
}
export const EXPORT_SQL = exportSql();

/** Full definitions for a few keys, when a hash-only row differs and the text is needed. Edit the list. */
export const DEFINITION_SQL = `-- READ ONLY
${FINGERPRINT_CTE}
SELECT category, key, def
  FROM objs WHERE (category, key) IN (('function', 'notify_user(uuid,text,text,text,jsonb)'))   -- edit
 ORDER BY category, key;`;

/** Run the export against an in-process database (PGlite) and return the parsed object. */
export async function fingerprintOf(db) {
  const r = await db.query(EXPORT_SQL.replace(/^--.*$/gm, ''));
  return JSON.parse(r.rows[0].fingerprint);
}
