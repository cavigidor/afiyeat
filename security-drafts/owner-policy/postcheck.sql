-- READ ONLY. After fix.sql: for each table and write command, the complete set of permissive policies.
-- Expected: exactly one policy per row (the named one), and its full text includes the custom_lists ownership
-- EXISTS shown in fix.sql. Read the text; then run the two-account test on the isolated project
-- (e0/security/owner-check.isolated.mjs --expect fixed). This query alone is not proof of behaviour.
SELECT t.tablename, c.cmd,
       count(p.policyname)                                         AS permissive_policies,
       string_agg(p.policyname, ', ')                              AS names,
       string_agg(coalesce(p.with_check, '(none)'), E'\n---\n')    AS with_check_full_text,
       string_agg(coalesce(p.qual, '(none)'), E'\n---\n')          AS using_full_text
  FROM (VALUES ('custom_list_statuses'), ('custom_list_types')) t(tablename)
 CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) c(cmd)
  LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = t.tablename
                         AND p.permissive = 'PERMISSIVE' AND p.cmd IN (c.cmd, 'ALL')
 GROUP BY t.tablename, c.cmd
 ORDER BY 1, 2;
