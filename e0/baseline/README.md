# Isolated backend and migration baseline (E0-b)

Goal: a second hosted Supabase project, owned by the product owner, that holds **no real user data** and whose
schema is **verified equal to production** before anything new is applied to it.

## What the baseline is

**B(S) = production's schema on the snapshot date S, including whichever integration-stack migrations production
already has on that date, verified by a schema comparison.**

It is not "production before the stack", and it is not a reconstruction that already includes the stack.
Each of the five pending stack migrations is applied to the isolated project **exactly once**: either inside
the baseline (if production already has it) or afterwards (if it does not). `stack-signatures.sql` decides which.

## The sequence

| Step | Where | Who | Writes to |
| --- | --- | --- | --- |
| 1. Production evidence | Production, through Lovable, read-only | Someone with Lovable access | Nothing |
| 2. Build baseline files | A laptop | Engineer | Local files |
| 3. Load baseline | Isolated project | Owner or engineer with its DB password | Isolated project only |
| 4. Record history | Isolated project | Same | Isolated project only |
| 5. Compare schemas | Both, read-only | Same | Nothing |
| 6. Apply remaining stack migrations | Isolated project | Same, after the PM authorizes it | Isolated project only |
| 7. Schema A and addendum | Isolated project | Same, after the PM approves the SQL | Isolated project only |

### 1. Production evidence (read-only)

Run in Lovable with the read-only sentence from `docs/INTEGRATION_ACCEPTANCE.md` section 2 (stack branch), one query at a time:

1. Who runs the query: section 2.0 of that document. Stop unless it is an admin role.
2. `stack-signatures.sql`: for each pending stack migration, `present`, `absent` or `partial`. **`partial` stops everything.**
3. `queries/fingerprint-1-summary.sql`: one hash per object category.
4. Migration history, sections 5a and 5b of that document, for the record.

Save every result table, unedited, with the date S.

### 2. Build the baseline files

```sh
cd e0 && npm ci
node baseline/build-baseline.mjs --out ../build/baseline --with <every migration step 1.2 reported present>
```

This writes `001_...sql` to `077_...sql` (plus any `--with` files) and `manifest.json`, which lists the files
and the pending migrations still to apply. The nine repaired files are marked in the manifest.

### 3. Load the baseline into the isolated project

```sh
ISOLATED_DB_URL='<isolated project connection string>' e0/baseline/load-baseline.sh build/baseline
```

The script refuses the production project. It stops at the first error; send the error rather than editing files.
The isolated project's `custom-list-images` bucket and secrets are set as in section 3, steps 4 and 5, of
`docs/INTEGRATION_ACCEPTANCE.md`.

### 4. Record what was loaded

So the CLI does not try to apply the same files again, mark exactly the loaded versions as applied
(Supabase CLI v2; on v3 add `--remote` at the end):

```sh
npx supabase@2 link --project-ref <isolated ref>
cat supabase/.temp/project-ref          # must print the isolated ref
npx supabase@2 migration repair --status applied <every version in manifest.json "files">
npx supabase@2 migration list           # the loaded versions show as applied; the pending ones do not
```

### 5. Compare the two schemas

Run `queries/fingerprint-1-summary.sql` on the isolated project (SQL editor or `psql`) and compare it with
production's result from step 1:

```sh
node e0/baseline/compare.mjs production-summary.csv isolated-summary.csv
```

For each category that differs, run `queries/fingerprint-2-detail.sql` on both (edit the category on its last
line), compare again, then `queries/fingerprint-3-definitions.sql` for the differing keys. Every difference is
either corrected in the isolated project (by a SQL file kept in `e0/baseline/evidence/`) or written into the
comparison log with its reason. **Acceptance for the baseline: the comparison log exists and has no unexplained row.**

Expected, explainable differences: `cron_job` (scheduled jobs may be left out of the isolated project on purpose),
`bucket` until step 3's bucket is created.

### 6. Apply the remaining stack migrations (only when authorized)

```sh
npx supabase@2 db push --dry-run    # must list exactly manifest.json "apply_afterwards_in_order", nothing else
npx supabase@2 db push
```

### 7. Schema A and the addendum (only when the PM approves the SQL)

Applied from `e0/schema/` with `psql -v ON_ERROR_STOP=1 -f`, never by copying them into `supabase/migrations/`,
then `e0/schema/schema_a_checks.sql`.

## Non-production app build

```sh
cp e0/staging/env.staging.local.example .env.staging.local     # fill in the isolated project's public values
npx vite build --mode staging
node e0/staging/check-build-target.mjs                          # must say OK before the build is installed anywhere
npx cap sync ios
```

Vite reads `.env.staging.local` over `.env` in this mode; `*.local` files are already ignored by git.
For installing on the iPhone without replacing the production app, follow `docs/INTEGRATION_ACCEPTANCE.md`
section 3 (stack branch). No production key, password or user data is needed anywhere in this procedure.
