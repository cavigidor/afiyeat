# Staging comparison: rehearsal

staging http://127.0.0.1:8102 · export 2026-11-20T05:33:20.705Z · baseline 2026-11-20T05:33:21.397Z · now 2026-11-20T05:33:32.512Z

| Table | exported | baseline | now | exported rows deleted | exported rows changed | rows added |
|---|---|---|---|---|---|---|
| folders | 7 | 7 | 7 | 0 | 0 | 0 |
| custom_lists | 11 | 11 | 11 | 0 | 0 | 0 |
| custom_list_statuses | 22 | 22 | 22 | 0 | 0 | 0 |
| custom_list_types | 5 | 5 | 5 | 0 | 0 | 0 |
| custom_list_items | 79 | 79 | 79 | 0 | 0 | 0 |
| custom_list_item_images | 7 | 7 | 7 | 0 | 0 | 0 |
| restaurants | 3 | 3 | 3 | 0 | 0 | 0 |
| restaurant_images | 4 | 4 | 4 | 0 | 0 | 0 |
| shared_lists | 1 | 1 | 1 | 0 | 0 | 0 |
| shared_list_items | 2 | 2 | 2 | 0 | 0 | 0 |
| shared_list_item_comments | 2 | 2 | 2 | 0 | 0 | 0 |
| follows | 4 | 4 | 4 | 0 | 0 | 0 |
| blocked_users | 1 | 1 | 1 | 0 | 0 | 0 |
| profiles | 1 | 1 | 1 | 0 | 1 | 0 |

## Checks

- Exported rows deleted: **0**
- Lists whose name, icon, owner or field settings changed: **0**
- Photos from the export still present: **10/10**
- New columns on existing lists (from the pending migrations): visibility, discovery_token

## Every change to an exported row (field: exported → now)

- profiles 51e41836-7cff-4b04-a996-fe0e8afd2851: updated_at: "2026-11-19T23:14:39.478902-06:00" → "2026-11-19T23:33:28.428193-06:00"