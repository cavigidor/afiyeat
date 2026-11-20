# Live production schema probes, 2026-11-19 (read-only)

Method: built-in browser on the PM's Mac, same-origin GET requests to
https://dmlkjpjubneqhbqoxlct.supabase.co/rest/v1 with the public anon key
(the one shipped in the app). Every table probe used `limit=0`; the script
stopped if any response contained a row (none did). Function probes used
wrong argument names, or (for functions revoked from anon) the correct ones,
so nothing executed. No writes, no data read.

Controls: unknown column -> 42703; unknown function -> PGRST202;
is_moderator() (exists, revoked from anon) -> 401 42501. Column names are
resolved before RLS/permission errors, so 401 "permission denied for function
is_moderator" on custom_lists / custom_list_items / restaurants / recipes
still proves every probed column exists.

| Probe | Result | Meaning |
|---|---|---|
| 57 table+column sets selected by main and by Lists V2 (trial 4973aa7) | 200 or 401(is_moderator) | all columns exist |
| custom_lists.visibility, custom_lists.discovery_token | 400 42703 | **#8 20261030120000 NOT applied** |
| content_reports.via_anonymous | 400 42703 | #8 not applied |
| rpc get_discoverable_list / get_list_discovery_preview / report_discoverable_list / can_view_custom_list | PGRST202 | #8 not applied (consistent) |
| rpc get_discovery_places(p_mode) with correct args | 404 PGRST202 (control: revoked existing fn gives 401) | **#10 20261109120000 NOT applied** |
| table notification_consents | 404 PGRST205 | PR #25 migration not applied (expected) |
| #7 20261029120000, #13 20261109180000, #14 20261111120000 | not observable via REST (policy-only) | need Lovable read-only pg_policies query |
| anon SELECT on custom_lists, custom_list_items, restaurants, recipes | 401 "permission denied for function is_moderator" | pre-existing: anonymous visitors get an error, not an empty list, on these tables |
