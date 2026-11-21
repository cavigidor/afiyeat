# E0: Lists V2 foundations (no feature code)

Tooling and review material for Lists V2 checkpoint E0. Nothing in this folder is part of the app build,
and nothing here is applied to any database automatically.

| Folder | PR | What it is |
| --- | --- | --- |
| `schema/` | E0-a | Schema A and the owner-check addendum, **as proposals for review**, with their tests |
| `lib/` | E0-a | Reads migration files from git or a folder; builds an in-process Postgres for tests |
| `baseline/` (added by E0-b) | E0-b | Reconstructs production's schema baseline for an isolated backend, and compares schemas |
| `security/` (added by E0-b) | E0-b | Read-only production verification for the owner-check gap; two-account test for the isolated backend |
| `staging/` (added by E0-b) | E0-b | Settings and a safety check for a non-production app build |

**Never** copy a file from `schema/` into `supabase/migrations/`. Lovable and the Supabase CLI apply that folder.

```sh
cd e0
npm ci
npm test            # schema proposals, in-process only (needs origin/main and origin/stack/14-photo-records-owner-check fetched)
```
