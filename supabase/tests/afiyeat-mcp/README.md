# afiyeat-mcp tests

Tests for the ChatGPT connector (`supabase/functions/afiyeat-mcp`). Everything
runs locally against synthetic data. Nothing here reads or writes the real
Afiyeat project.

| File | What it covers |
|---|---|
| `recipes_test.ts` | Unit tests: input validation, normalisation, duplicate fingerprint, update patches. No database. |
| `mcp_e2e_test.ts` | End-to-end through the same HTTP interface ChatGPT uses: OAuth discovery, token checks, owner isolation under the real RLS policies, private-by-default saves, exact field readback, duplicate prevention (including concurrent retries), list/get/update, both MCP protocol generations. |
| `harness.ts` | A local stand-in for a Supabase project: PostgREST over a database built from the repo's migrations, test signing keys, and the function running under Deno behind a gateway that mimics Supabase's routing. |
| `setup_db.sh` | Builds that database from `supabase_scaffold.sql` plus every file in `supabase/migrations/`. |

## Running

You need `deno` 2.x, `psql`, a local Postgres 16 you can create databases in,
and a [PostgREST](https://github.com/PostgREST/postgrest/releases) binary.

```sh
export PGHOST=/tmp PGPORT=5432 PGUSER=postgres   # your local Postgres
export POSTGREST_BIN=/path/to/postgrest
supabase/tests/afiyeat-mcp/run_tests.sh          # unit + end-to-end
supabase/tests/afiyeat-mcp/run_tests.sh unit     # unit only, no database
```

The end-to-end test starts the function on port 8000 (Deno's default), so
that port must be free.

`setup_db.sh` drops and recreates the `afiyeat_mcp_test` database each run.
A few unrelated migrations (Explore, device tokens, Lovable's re-applied
copies) don't replay cleanly on a fresh database because they were
reconciled by hand in production; the script reports and skips those, and
then checks that every recipe policy and the import-key constraint exist.
