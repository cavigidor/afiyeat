# Database proposals (not migrations)

Files here are **not** in `supabase/migrations/` on purpose: nothing applies them to Lovable Cloud or
production. They are tested on an in-process copy of every migration (`tests/*.db.test.ts`) and in the
isolated local lab only.

| File | What | Status |
| --- | --- | --- |
| `lists_v2_owner_fields.sql` | Preset item fields: `custom_list_owner_settings` (a list's field definitions) and `custom_list_item_owner_values` (an item's values). Owner-only RLS, type checks, counted field delete, owner export. The two-table part of PR #24, without brews, layout or Schema A. | PM-approved for isolated testing only (2026-11-20). Not applied anywhere hosted. |
| `lists_v2_owner_fields_precheck.sql` / `_postcheck.sql` | Read-only checks before and after applying (the postcheck includes an exact-text digest). | — |
| `lists_v2_owner_fields_park.sql` / `_unpark.sql` | Recovery that keeps every saved detail: move both tables out of the app's reach and back. | — |
| `lists_v2_owner_fields_rollback.sql` | Full removal. Refuses while saved details exist unless a backup is confirmed. | — |

Production plan: [`docs/release/lists-v2/FIELDS_MIGRATION_PLAN.md`](../../docs/release/lists-v2/FIELDS_MIGRATION_PLAN.md).

Tests: `tests/listOwnerFields.db.test.ts` (replays all migrations, then applies the proposal: owner
save/reopen, empty fields, unchanged items, validation, hide keeps values, counted delete, export,
follower/stranger/signed-out privacy, discovery and previews never include values, rollback).

When production approval comes, the SQL moves unchanged into a new timestamped migration.
