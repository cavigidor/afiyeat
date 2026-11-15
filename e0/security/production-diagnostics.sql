-- =====================================================================
-- Restaurants, moderation grants and Realtime: READ-ONLY production diagnostics
-- For a SEPARATELY AUTHORIZED Lovable operator. Not run by Claude. Prepared 2026-11-15.
--
-- Twelve queries, P0-P11, each a single SELECT. Nothing here writes. No query returns a user id, email,
-- name or content: only catalog definitions, privileges, flags and COUNTS.
--
-- Paste one query at a time into Lovable with this sentence above it:
--   "Run this read-only SQL query against the Cloud database exactly as written and show me
--    the full result table. It only reads. Do not create a migration, do not change anything,
--    and do not 'fix' anything it shows."
-- Decline any "Apply" or migration button. Save every result unedited, with the date.
--
-- How to read the results: they describe configuration. They do not prove what any user did or could do;
-- behaviour is confirmed only by the signed-out / follower / stranger / blocked tests on the isolated project.
-- Counts in P10-P11 are integrity anomalies, not proof of exploitation (see P10).
-- =====================================================================

-- P0  Who runs the queries. Must be an admin role (postgres / supabase_admin). If it says authenticated
--     or anon, STOP: row-level security would hide rows and every count below would be wrong.
-- READ ONLY
SELECT current_user, session_user, current_setting('server_version') AS postgres_version, now() AS checked_at;

-- P1  Row-level security on every table a My Restaurants read or a moderation decision touches.
-- READ ONLY
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced, pg_get_userbyid(c.relowner) AS owner
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('restaurants', 'restaurant_images', 'moderation_hidden', 'content_reports', 'user_roles',
                     'blocked_users', 'follows', 'profiles', 'place_cache')
 ORDER BY 1;

-- P2  Every policy on those tables, complete text, permissive and restrictive, all commands.
--     Read the whole text; do not search it for words.
-- READ ONLY
SELECT tablename, cmd, permissive, policyname, roles, qual AS using_expression, with_check AS with_check_expression
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('restaurants', 'restaurant_images', 'moderation_hidden', 'content_reports', 'user_roles',
                     'blocked_users', 'follows', 'profiles', 'place_cache')
 ORDER BY tablename, cmd, permissive, policyname;

-- P3  Table privileges for the API roles and PUBLIC. Row-level security only matters for privileges a role has.
-- READ ONLY
SELECT t.table_name, r.role_name,
       has_table_privilege(r.role_name, 'public.' || t.table_name, 'SELECT') AS can_select,
       has_table_privilege(r.role_name, 'public.' || t.table_name, 'INSERT') AS can_insert,
       has_table_privilege(r.role_name, 'public.' || t.table_name, 'UPDATE') AS can_update,
       has_table_privilege(r.role_name, 'public.' || t.table_name, 'DELETE') AS can_delete
  FROM (VALUES ('restaurants'), ('restaurant_images'), ('moderation_hidden'), ('content_reports'), ('user_roles'),
               ('blocked_users'), ('follows'), ('profiles'), ('place_cache')) AS t(table_name)
 CROSS JOIN (VALUES ('anon'), ('authenticated'), ('public')) AS r(role_name)
 WHERE to_regclass('public.' || t.table_name) IS NOT NULL
 ORDER BY 1, 2;

-- P4  Column-level privileges on restaurants (if any column is granted or revoked individually).
--     An empty result means none: every readable row is readable in every column, details included.
-- READ ONLY
SELECT a.attname AS column_name,
       CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee, x.privilege_type
  FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
 WHERE a.attrelid = 'public.restaurants'::regclass AND a.attacl IS NOT NULL AND a.attnum > 0 AND NOT a.attisdropped
 ORDER BY 1, 2, 3;

-- P5  Every function that a policy on those tables CALLS (from the dependency catalog, not from text),
--     with who may execute it. In the reconstruction, signed-out reads of restaurants are refused only
--     because a restrictive policy calls is_moderator(), which anon may not execute; this shows whether
--     production is the same.
-- READ ONLY
SELECT DISTINCT cl.relname AS table_name, pol.polname AS policy_name, p.oid::regprocedure::text AS function,
       p.prosecdef AS security_definer, pg_get_userbyid(p.proowner) AS function_owner,
       EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE') AS public_can_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
  FROM pg_policy pol
  JOIN pg_class cl ON cl.oid = pol.polrelid
  JOIN pg_depend d ON d.classid = 'pg_policy'::regclass AND d.objid = pol.oid AND d.refclassid = 'pg_proc'::regclass
  JOIN pg_proc p ON p.oid = d.refobjid
 WHERE cl.relnamespace = 'public'::regnamespace
   AND cl.relname IN ('restaurants', 'restaurant_images', 'moderation_hidden', 'content_reports', 'user_roles',
                      'blocked_users', 'follows', 'profiles', 'custom_lists', 'custom_list_items', 'custom_list_item_images')
 ORDER BY 1, 2, 3;

-- P6  The moderation and visibility helpers by name, whether or not a policy calls them, with full flags.
-- READ ONLY
SELECT p.oid::regprocedure::text AS function, p.prosecdef AS security_definer, p.provolatile AS volatility,
       coalesce(array_to_string(p.proconfig, ','), '') AS settings, pg_get_userbyid(p.proowner) AS owner,
       EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE') AS public_can_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('is_moderator', 'is_moderation_hidden', 'is_blocked_pair', 'moderation_decide', 'moderation_list_reports',
                     'moderation_content_owner', 'can_view_custom_list', 'has_role', 'get_shared_preview')
 ORDER BY 1;

-- P7  The complete definitions of the moderator check and of moderation_decide, to read who counts as a
--     moderator and what a moderator may change. Definitions only.
-- READ ONLY
SELECT p.oid::regprocedure::text AS function, pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('is_moderator', 'moderation_decide', 'has_role')
 ORDER BY 1;

-- P8  Realtime: the publication(s) and every published table, with published columns and row filters.
--     Realtime delivers row changes of published tables to subscribed clients, subject to RLS for
--     postgres_changes. A table not listed here is not published.
-- READ ONLY
SELECT p.pubname, p.puballtables AS all_tables, p.pubinsert, p.pubupdate, p.pubdelete, p.pubtruncate,
       t.schemaname, t.tablename,
       to_jsonb(t) -> 'attnames' AS published_columns, to_jsonb(t) ->> 'rowfilter' AS row_filter
  FROM pg_publication p LEFT JOIN pg_publication_tables t ON t.pubname = p.pubname
 ORDER BY p.pubname, t.schemaname, t.tablename;

-- P9  Realtime authorization (broadcast / presence channels): row-level security and policies on
--     realtime.messages, if that table exists. An empty result means it does not exist or has no policies.
-- READ ONLY
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, pol.policyname, pol.cmd, pol.permissive, pol.roles,
       pol.qual AS using_expression, pol.with_check AS with_check_expression
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'realtime'
  LEFT JOIN pg_policies pol ON pol.schemaname = 'realtime' AND pol.tablename = c.relname
 WHERE c.relname = 'messages'
 ORDER BY pol.cmd, pol.policyname;

-- P10 Integrity anomaly COUNTS for restaurant photos and moderation rows. Counts only.
--     A non-zero count is an integrity anomaly: a row whose owner or target is not what the current rules
--     would allow. It is NOT proof that anyone exploited anything - such rows can come from an old app bug,
--     a data repair, an account merge, a deleted parent, or a flow not yet identified - and zero is not proof
--     that nothing happened (rows can be deleted). Do not delete or change anything.
-- READ ONLY
SELECT
  (SELECT count(*) FROM public.restaurant_images i JOIN public.restaurants r ON r.id = i.restaurant_id
    WHERE i.user_id <> r.user_id)                                               AS photos_owner_differs_from_place_owner,
  (SELECT count(*) FROM public.restaurant_images i
    WHERE NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = i.restaurant_id)) AS photos_without_place,
  (SELECT count(*) FROM public.moderation_hidden)                               AS hidden_items_total,
  (SELECT count(*) FROM public.user_roles)                                      AS role_assignments_total,
  (SELECT count(DISTINCT role::text) FROM public.user_roles)                    AS distinct_roles;

-- P11 Realtime subscriptions currently registered, per subscribed table. COUNTS ONLY; no user or filter.
--     Shows which tables clients actually listen to. An error ("relation does not exist") is a valid answer.
-- READ ONLY
SELECT entity::regclass::text AS subscribed_table, count(*) AS subscriptions
  FROM realtime.subscription
 GROUP BY 1 ORDER BY 1;
