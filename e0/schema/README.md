# Schema proposals (E0-a)

**Status: proposals for PM review. Not approved. Not applied anywhere.**

| File | What it is |
| --- | --- |
| `schema_a_proposal.sql` | Schema A: additive columns, one owner-only table, one index, ten functions. Changes no existing policy. |
| `schema_a_addendum_owner_check.sql` | Separate security fix: list-ownership check on status and category writes. Replaces four policies. |
| `schema_a_checks.sql` | Read-only pre-check and post-check queries for Schema A |
| `tests/schema_a.test.mjs` | 17 behaviour and security tests for Schema A |
| `tests/schema_a_addendum.test.mjs` | 6 tests for the addendum, including the gap before it |
| `tests/privacy.test.mjs` | 7 tests: who can read stored detail values (owner, follower, stranger, signed out, blocked, hidden) |

## What the tests run on

An in-process Postgres (PGlite, Postgres 18) built by `lib/migrations.mjs`:

1. Stand-ins for what Supabase provides (`auth.uid()`, `auth.users`, storage, cron, net): `lib/supabase-stubs.sql`.
2. Every migration on `origin/main`, in order. Nine of them do not replay on an empty database; they get the
   mechanical rewrites listed in `lib/repairs.json` (for example `CREATE TABLE` becomes `CREATE TABLE IF NOT EXISTS`).
   The other 68 are applied exactly as committed.
3. The integration stack's five pending migrations, read from `E0_STACK_REF`
   (default `origin/stack/14-photo-records-owner-check`), because Schema A depends on two of them (#7, #8).
4. The proposal under test.

Limits: this approximates production, it is not a copy; Postgres 18 here may print some definitions differently
from production's Postgres; there is one connection, so row locks are exercised only in sequence; Supabase Auth,
Storage and the HTTP API are not involved. Those are covered by the isolated backend (`../baseline/README.md`).
