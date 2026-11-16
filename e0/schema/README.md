# Schema proposals (E0-a)

**Status: proposals for PM review. Not approved. Not applied anywhere. Not migrations.**
Nothing in this folder belongs in `supabase/migrations/`, and none of it may be pasted into Lovable.

| File | What it is |
| --- | --- |
| `schema_a_proposal.sql` | Schema A: additive columns, one owner-only table, one index, functions, one insert trigger (Travel). Changes no existing policy. |
| `schema_a_my_restaurants_private_fields.sql` | Addendum P1 (recommended): My Restaurants custom-field values in an owner-only table. |
| `schema_a_addendum_owner_check.sql` | Separate security fix: list-ownership check on status and category writes. Replaces four policies. Also carried, with its own plan, on the independent security draft (see `../security/owner-policy/`). |
| `lists_v2_owner_fields_and_brews.sql` | **LV2-DB-1/2 (2026-11-16):** the smallest change for Lists V2 custom fields, layout across devices and coffee brew records. Three new owner-only tables; independent of Schema A. Rollback: `lists_v2_owner_fields_and_brews_rollback.sql`. |
| `tests/lists_v2_owner_fields_and_brews.test.mjs` | 16 tests for LV2-DB-1/2: owner-only reads and writes, typed values, hide keeps values, guarded and counted delete, export, cascades, existing tables and policies unchanged, rollback |
| `schema_a_checks.sql` | Read-only pre-check and post-check queries for Schema A |
| `tests/schema_a.test.mjs` | 17 behaviour and security tests for Schema A |
| `tests/schema_a_regressions.test.mjs` | 17 regression tests for the three cases the PM reproduced (R1 Travel audience, R2 preset version, R3 checklist identity) |
| `tests/my_restaurants_private_fields.test.mjs` | 15 tests for addendum P1, including hide, confirmed delete and owner export |
| `tests/schema_a_addendum.test.mjs` | 6 tests for the owner-check addendum, including the gap before it |
| `tests/privacy.test.mjs` | 7 tests: who can read stored detail values (owner, follower, stranger, signed out, blocked, hidden) |
| `../concurrency/two-connection.local.test.mjs` | 11 genuine two-connection tests on a local Postgres 16 server |

Run: `npm test` (PGlite suites) and `npm run test:concurrency` (starts a socket-only local server under `/tmp`).

## LV2-DB-1/2: owner fields and brew records (2026-11-16)

Why: Lists V2 is being built on the existing database. Two features cannot be saved there without
misusing a column: user-defined fields (text, number, date, tags, choice) and several brewing records per Coffee Beans
item. The app keeps both behind "needs approval"; nothing is faked in local state.

| Part | What | Who can read or write |
| --- | --- | --- |
| `custom_list_owner_settings` | One row per list: field definitions (`fields`, max 30) and `layout` (field order, view, sort) | The list owner only |
| `custom_list_item_owner_values` | One row per item: `{c_key: value}`, each checked against its definition's type | The list owner only |
| `custom_list_item_brews` | Any number of brews per item: date, method, dose, water, grind, temperature, time, rating, notes | The list owner only |
| `count_custom_list_field_values`, `delete_custom_list_field` | O1: the count to show, then an atomic delete refused if the count changed | Invoker rights |
| `export_my_list_owner_data` | O3: the caller's own rows, without user ids | Signed-in callers, own rows |

Does not change any existing table, column, policy, function, grant, bucket, Edge Function or Realtime publication
(tests DB-2, DB-14, DB-16). Old app builds never read the new tables. Converting a custom list into a shared list
does not copy these rows (shared lists stay as they are). Rollback drops the three tables and the functions; their
data is lost unless exported first.

## Corrections in this checkpoint (2026-11-15)

| Case | Before | Now | Tests |
| --- | --- | --- | --- |
| R1 Travel audience omitted | `p_visibility DEFAULT 'profile'`: an omitted audience shared the list | Every new Travel row starts Only me (function default and a `BEFORE INSERT` trigger). Sharing is a separate, explicit write; the function makes it only when the caller passes `'profile'`. Other presets keep today's default. | R1 x6 |
| R2 preset key without version | `CHECK (... OR (key_ok(key) AND version >= 1))`: with a NULL version the expression is NULL, and a CHECK passes on NULL | Both halves say `IS NOT NULL`; the function refuses a mismatched pair before writing | R2 x4 |
| R3 checklist add identity | Identity came from `COALESCE(op.id, entry.id)`; an outer id that differed from `entry.id` stored the entry under one id and deduplicated by the other | `entry.id` is the only identity; a differing outer id is refused; the entry is rebuilt from `id, text, price, link, done` with type checks; `set` cannot change an id; `lists_v2_details_ok` refuses duplicate or missing entry ids on every write path | R3 x7 |
| Found while testing concurrency | A retry racing the original `create_list_from_preset` got a raw `23505` (select-then-insert) | `INSERT ... ON CONFLICT (id) DO NOTHING`, then an owner check: the racing retry returns the list | C1 (fails on the old SQL) |

Intended behaviour change: checklist entries are stored normalised, so an entry added without `done` is stored with
`done: false` (one assertion in `schema_a.test.mjs` was updated for this).

## My Restaurants custom fields: privacy options

The problem: Schema A keeps a custom field's label owner-only but its value in `restaurants.details`, which every
reader of the row can read (any signed-in user, for a public profile).

| Option | How | Verdict |
| --- | --- | --- |
| **P1 (recommended)** | Definitions in `user_list_settings.restaurants_config.custom_fields` (owner-only). Values in a new owner-only table `restaurant_private_details` (one row per place, every policy checks both row owner and place owner, not in Realtime, no anon grant). Custom keys must start with `c_`; `restaurants.details` refuses `c_` keys; the private table accepts nothing else; a value needs an owner definition. | Private by construction. One extra table and one extra read for the owner's own detail screen. |
| P2 | Keep values in `restaurants.details`, hide them in a view or function | Rejected: row-level security is per row, not per key; any direct `select` on `restaurants` would still return them. |
| P3 | Per-field audience chosen by the owner | Deferred: more settings, against "minimal interaction". P1 does not prevent adding it later. |

What P1 leaves unchanged: preset detail fields of My Restaurants keep the row's existing audience (same readers as
notes and rating today); custom-list details keep their explicit audience (`custom_lists.visibility` through
`can_view_custom_list()`).

PM decisions (2026-11-15), now built into P1 and tested (`P1-12` to `P1-15`, `C11`):

| Decision | How P1 meets it |
| --- | --- |
| O1 hiding keeps values | `custom_fields.<key>.hidden = true` through `patch_restaurants_config`; values untouched |
| O1 permanent delete: confirmed, count disclosed, atomic | `count_restaurant_custom_field_values(key)` gives the number to show; `delete_restaurant_custom_field(key, expected_count)` refuses unless the count still matches, then removes the values and the definition in one transaction. A trigger refuses removing a definition any other way while values exist. A concurrent value write waits and then fails; a stale count is refused (two-connection test C11). |
| O2 owner-only in V2 | No policy, function, publication or grant gives anyone else access |
| O3 owner export only | `export_my_restaurant_private_fields()` (SECURITY INVOKER, authenticated only) returns the caller's definitions and values; strangers get none, signed-out callers are refused. The existing PDF export reads no details. |

### Review of P1 (RLS, function permissions, export, deletion)

* **RLS:** enabled and forced; every policy requires both `user_id = auth.uid()` and that the caller owns the place,
  so re-pointing a row at another place fails. Not in Realtime. No anon or PUBLIC grant.
* **Functions:** all four writers/readers are SECURITY INVOKER with `search_path = public` and EXECUTE for
  `authenticated` only; the helpers are pure. Residual risk: a future SECURITY DEFINER function owned by a role that
  bypasses RLS could read the table. Test P1-15 is a tripwire for that, not a proof; code review remains the control.
* **Cascade:** deleting a place or an account deletes its private values.
* **Not covered locally:** behaviour through PostgREST and real Auth, old app builds (they never send `c_` keys),
  and the UI that shows the count before the delete. These are isolated-project and device gates.

## What the tests run on

An in-process Postgres (PGlite, Postgres 18) built by `lib/migrations.mjs`:

1. Stand-ins for what Supabase provides (`auth.uid()`, `auth.users`, storage, cron, net): `lib/supabase-stubs.sql`.
2. Every migration on `origin/main`, in order. Nine of them do not replay on an empty database; they get the
   mechanical rewrites listed in `lib/repairs.json` (for example `CREATE TABLE` becomes `CREATE TABLE IF NOT EXISTS`).
   The other 68 are applied exactly as committed.
3. The integration stack's five pending migrations, read from `E0_STACK_REF`
   (default `origin/stack/14-photo-records-owner-check`), because Schema A depends on two of them (#7, #8).
4. The proposal under test.

The two-connection tests build the same sequence on a local Postgres 16 server (`lib/localpg.mjs`), reachable only
through a Unix socket under `/tmp`, and hold real transactions open so that each second call must wait on the first;
every test asserts that the wait happened.

Limits: this approximates production, it is not a copy; Postgres 16/18 here may differ from production's version and
settings; Supabase Auth, Storage, PostgREST and the network are not involved. Those are covered by the isolated-backend
scripts (`../concurrency/two-connection.isolated.mjs`, `../security/`), which have **not** been run.
