-- Read-only. Run AFTER social_sign_in_account_safety.sql. Every row must say ok = true.
-- Changes nothing.
SELECT 'terms_acceptances exists with RLS on' AS check, coalesce((
  SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.terms_acceptances')), false) AS ok
UNION ALL
SELECT 'terms_acceptances has exactly one policy: SELECT own rows', (
  SELECT count(*) = 1 AND bool_and(cmd = 'SELECT' AND qual LIKE '%auth.uid()%')
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'terms_acceptances')
UNION ALL
SELECT 'anon has no privileges on terms_acceptances', NOT (
  has_table_privilege('anon', 'public.terms_acceptances', 'SELECT')
  OR has_table_privilege('anon', 'public.terms_acceptances', 'INSERT')
  OR has_table_privilege('anon', 'public.terms_acceptances', 'UPDATE')
  OR has_table_privilege('anon', 'public.terms_acceptances', 'DELETE'))
UNION ALL
SELECT 'authenticated can only SELECT terms_acceptances',
  has_table_privilege('authenticated', 'public.terms_acceptances', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.terms_acceptances', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.terms_acceptances', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.terms_acceptances', 'DELETE')
UNION ALL
SELECT 'terms_acceptances is empty (nothing recorded yet)', (SELECT count(*) = 0 FROM public.terms_acceptances)
UNION ALL
SELECT 'complete_account_setup: SECURITY DEFINER, fixed search_path, authenticated only', (
  SELECT p.prosecdef AND p.proconfig::text LIKE '%search_path=public, pg_temp%'
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    FROM pg_proc p WHERE p.oid = 'public.complete_account_setup(text, text, text, text)'::regprocedure)
UNION ALL
SELECT 'social_sign_in_ready answers v1 and is callable when signed out', (
  public.social_sign_in_ready() = 'v1'
  AND has_function_privilege('anon', 'public.social_sign_in_ready()'::regprocedure, 'EXECUTE'))
UNION ALL
SELECT 'social_account_discard_check: SECURITY DEFINER, service_role only', (
  SELECT p.prosecdef AND p.proconfig::text LIKE '%search_path=public, pg_temp%'
     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    FROM pg_proc p WHERE p.oid = 'public.social_account_discard_check(uuid)'::regprocedure)
UNION ALL
SELECT 'discard check refuses an unknown account', (
  public.social_account_discard_check('00000000-0000-0000-0000-000000000000') ->> 'eligible') = 'false';
