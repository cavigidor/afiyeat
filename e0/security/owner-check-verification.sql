-- =====================================================================
-- Owner-check gap on custom_list_statuses / custom_list_types
-- READ-ONLY production verification package. Six queries, each a single SELECT.
-- Nothing here writes, and no query returns a user id, name, email or content:
-- only policy text, flags, privileges and COUNTS.
--
-- Paste one query at a time into Lovable with this sentence above it:
--   "Run this read-only SQL query against the Cloud database exactly as written and show me
--    the full result table. It only reads. Do not create a migration, do not change anything,
--    and do not 'fix' anything it shows."
-- Decline any "Apply" or migration button.
-- =====================================================================

-- V0  Who runs the queries. Expected: an admin role (postgres / supabase_admin).
--     If it says authenticated or anon, STOP: row-level security would hide rows and V4 would undercount.
-- READ ONLY
SELECT current_user, session_user, current_setting('server_version') AS postgres_version, now() AS checked_at;

-- V1  Every policy on the two tables (and their parent table, for context), all commands including ALL,
--     with permissive/restrictive, roles, USING and WITH CHECK exactly as stored.
--     Read the complete text of every PERMISSIVE INSERT/UPDATE/ALL policy; do not search it for words.
--     Postgres ORs permissive policies, so the gap is open if ANY one of them admits a row whose list belongs to
--     someone else. Whether it does is confirmed by the two-account test on the isolated project
--     (owner-check.isolated.mjs), not by reading alone. (Correction 2026-11-15: an earlier note here suggested
--     looking for the word custom_lists in with_check; a substring proves nothing.)
-- READ ONLY
SELECT tablename, policyname, cmd, permissive, roles, qual AS using_expression, with_check AS with_check_expression
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename IN ('custom_list_statuses', 'custom_list_types', 'custom_lists')
 ORDER BY tablename, cmd, permissive, policyname;

-- V2  Row-level security switched on (and forced) on the three tables.
-- READ ONLY
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
  FROM pg_class c
 WHERE c.oid IN ('public.custom_list_statuses'::regclass, 'public.custom_list_types'::regclass, 'public.custom_lists'::regclass)
 ORDER BY 1;

-- V3  Table privileges held by the API roles. RLS only matters for privileges a role actually has.
-- READ ONLY
SELECT t.table_name, r.role_name,
       has_table_privilege(r.role_name, 'public.' || t.table_name, 'SELECT') AS can_select,
       has_table_privilege(r.role_name, 'public.' || t.table_name, 'INSERT') AS can_insert,
       has_table_privilege(r.role_name, 'public.' || t.table_name, 'UPDATE') AS can_update,
       has_table_privilege(r.role_name, 'public.' || t.table_name, 'DELETE') AS can_delete
  FROM (VALUES ('custom_list_statuses'), ('custom_list_types'), ('custom_lists')) AS t(table_name)
 CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
 ORDER BY 1, 2;

-- V4  Existing rows whose owner differs from their parent list's owner. COUNTS ONLY.
--     A non-zero count is an INTEGRITY ANOMALY, not proof that anyone exploited the gap. Rows like these can
--     also come from an old app bug, a data repair, an account merge, a list whose owner changed, or a
--     legitimate flow not yet identified. Interpreting them needs the row-level history, which this query
--     deliberately does not read. Zero is also not proof that the gap was never used: a row can have been
--     written and later deleted. Do not delete or change anything; any clean-up is a separate decision.
--     (Correction 2026-11-15: an earlier note here said a non-zero row "means the gap was used".)
-- READ ONLY
SELECT 'custom_list_statuses' AS table_name,
       count(*)                                  AS rows_total,
       count(*) FILTER (WHERE s.user_id <> l.user_id) AS rows_owned_by_someone_else,
       count(DISTINCT s.list_id) FILTER (WHERE s.user_id <> l.user_id) AS lists_affected,
       count(DISTINCT s.user_id) FILTER (WHERE s.user_id <> l.user_id) AS distinct_foreign_writers,
       min(s.created_at) FILTER (WHERE s.user_id <> l.user_id) AS first_seen,
       max(s.created_at) FILTER (WHERE s.user_id <> l.user_id) AS last_seen
  FROM public.custom_list_statuses s JOIN public.custom_lists l ON l.id = s.list_id
UNION ALL
SELECT 'custom_list_types',
       count(*),
       count(*) FILTER (WHERE t.user_id <> l.user_id),
       count(DISTINCT t.list_id) FILTER (WHERE t.user_id <> l.user_id),
       count(DISTINCT t.user_id) FILTER (WHERE t.user_id <> l.user_id),
       min(t.created_at) FILTER (WHERE t.user_id <> l.user_id),
       max(t.created_at) FILTER (WHERE t.user_id <> l.user_id)
  FROM public.custom_list_types t JOIN public.custom_lists l ON l.id = t.list_id;

-- V5  Related integrity: items pointing at a status or category that belongs to a DIFFERENT list. COUNTS ONLY.
--     Not caused by this gap, but the same family of cross-list references; reported so the fix is judged with it.
-- READ ONLY
SELECT
  (SELECT count(*) FROM public.custom_list_items i JOIN public.custom_list_statuses s ON s.id = i.status_id
    WHERE s.list_id <> i.list_id)                                                    AS items_with_status_from_other_list,
  (SELECT count(*) FROM public.custom_list_items i
    WHERE EXISTS (SELECT 1 FROM unnest(i.type_ids) AS tid JOIN public.custom_list_types t ON t.id = tid
                   WHERE t.list_id <> i.list_id))                                    AS items_with_category_from_other_list,
  (SELECT count(*) FROM public.custom_list_items i
    WHERE EXISTS (SELECT 1 FROM unnest(i.type_ids) AS tid
                   WHERE NOT EXISTS (SELECT 1 FROM public.custom_list_types t WHERE t.id = tid))) AS items_with_missing_category;

-- V6  Do the policy NAMES the fix replaces exist exactly as named? The fix drops by name; a differently named
--     permissive policy would survive and keep the gap open (Postgres ORs permissive policies).
-- READ ONLY
SELECT n.expected_name, n.table_name, n.cmd,
       EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = n.table_name AND p.policyname = n.expected_name) AS exists_by_name,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = n.table_name
                                             AND p.cmd IN (n.cmd, 'ALL') AND p.permissive = 'PERMISSIVE') AS permissive_policies_for_cmd
  FROM (VALUES ('Users can insert their own list statuses', 'custom_list_statuses', 'INSERT'),
               ('Users can update their own list statuses', 'custom_list_statuses', 'UPDATE'),
               ('Users can insert their own list types',    'custom_list_types',    'INSERT'),
               ('Users can update their own list types',    'custom_list_types',    'UPDATE')) AS n(expected_name, table_name, cmd)
 ORDER BY 2, 3;
