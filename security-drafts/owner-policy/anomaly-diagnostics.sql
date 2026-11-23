-- READ ONLY. O-S1 diagnostics: statuses and categories whose owner differs from their list's owner.
-- COUNTS ONLY - no ids, names, emails or content. For a separately authorized Lovable operator, one query.
-- A non-zero count is an integrity anomaly, not proof of exploitation (old app bugs, repairs, merged accounts,
-- changed list owners and unidentified flows produce the same shape); zero is not proof of no use.
-- Nothing here deletes, reassigns or changes anything.
-- READ ONLY
WITH s AS (
  SELECT 'custom_list_statuses'::text AS table_name, x.id, x.list_id, x.user_id, x.created_at, l.user_id AS list_owner,
         EXISTS (SELECT 1 FROM public.custom_list_items i WHERE i.status_id = x.id) AS in_use,
         EXISTS (SELECT 1 FROM public.custom_list_items i WHERE i.status_id = x.id AND i.user_id = l.user_id) AS used_by_list_owner
    FROM public.custom_list_statuses x JOIN public.custom_lists l ON l.id = x.list_id
   WHERE x.user_id <> l.user_id
  UNION ALL
  SELECT 'custom_list_types', x.id, x.list_id, x.user_id, x.created_at, l.user_id,
         EXISTS (SELECT 1 FROM public.custom_list_items i WHERE x.id = ANY (i.type_ids)),
         EXISTS (SELECT 1 FROM public.custom_list_items i WHERE x.id = ANY (i.type_ids) AND i.user_id = l.user_id)
    FROM public.custom_list_types x JOIN public.custom_lists l ON l.id = x.list_id
   WHERE x.user_id <> l.user_id
)
SELECT t.table_name,
       count(s.id)                                                   AS anomalous_rows,
       count(DISTINCT s.list_id)                                     AS lists_affected,
       count(DISTINCT s.list_owner)                                  AS list_owners_affected,
       count(DISTINCT s.user_id)                                     AS distinct_row_owners,
       count(s.id) FILTER (WHERE s.in_use)                           AS rows_referenced_by_items,
       count(s.id) FILTER (WHERE s.used_by_list_owner)               AS rows_used_by_the_list_owner,
       count(s.id) FILTER (WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = s.user_id)) AS row_owner_account_gone,
       min(s.created_at)                                             AS first_created,
       max(s.created_at)                                             AS last_created
  FROM (VALUES ('custom_list_statuses'), ('custom_list_types')) t(table_name)
  LEFT JOIN s ON s.table_name = t.table_name
 GROUP BY t.table_name
 ORDER BY 1;
