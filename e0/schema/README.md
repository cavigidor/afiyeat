# Schema proposals (E0-a)

**Status: proposals for PM review. Not approved. Not applied anywhere. Not migrations.**
Nothing in this folder belongs in `supabase/migrations/`, and none of it may be pasted into Lovable.

| File | What it is |
| --- | --- |
| `schema_a_proposal.sql` | Schema A: additive columns, one owner-only table, one index, functions, one insert trigger (Travel). Changes no existing policy. |
| `schema_a_my_restaurants_private_fields.sql` | Addendum P1 (recommended): My Restaurants custom-field values in an owner-only table. |
| `schema_a_addendum_owner_check.sql` | Separate security fix: list-ownership check on status and category writes. Replaces four policies. Also carried, with its own plan, on the independent security draft (see `../security/owner-policy/`). |
| `schema_a_checks.sql` | Read-only pre-check and post-check queries for Schema A |
| `tests/schema_a.test.mjs` | 17 behaviour and security tests for Schema A |
| `tests/schema_a_regressions.test.mjs` | 17 regression tests for the three cases the PM reproduced (R1 Travel audience, R2 preset version, R3 checklist identity) |
| `tests/my_restaurants_private_fields.test.mjs` | 11 tests for addendum P1 |
| `tests/schema_a_addendum.test.mjs` | 6 tests for the owner-check addendum, including the gap before it |
| `tests/privacy.test.mjs` | 7 tests: who can read stored detail values (owner, follower, stranger, signed out, blocked, hidden) |
| `../concurrency/two-connection.local.test.mjs` | 10 genuine two-connection tests on a local Postgres 16 server |

Run: `npm test` (PGlite suites) and `npm run test:concurrency` (starts a socket-only local server under `/tmp`).

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

Open owner decisions: O1 keep or purge values when a definition is deleted (P1 keeps them, owner-only, not shown);
O2 whether a custom field may ever be shared with the row's audience; O3 whether the owner's export includes them.

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
