# Isolated backend and migration baseline (E0-b) — revised setup, 2026-11-15

Goal: a second hosted Supabase project, owned by the PM, that holds **no real user data and no production secret**,
whose schema is **verified equal to production within the documented coverage** before anything new is applied.

Nothing in this folder has been run against any hosted project. Everything below marked *rehearsed* has been run
end-to-end on a local, socket-only Postgres 16 (`npm run test:rehearsal`).

## What the baseline is

**B(S) = production's schema on the snapshot date S, including whichever integration-stack migrations production
already has on that date.** Each of the five pending stack migrations is applied to the isolated project exactly
once: inside the baseline if production has it, afterwards (from the separate `pending/` folder) if not.
Which ones production has is decided by `detect-stack.mjs` from a full fingerprint, **never by policy names or
substrings** (`stack-signatures.withdrawn.sql` did that and was wrong; it is kept only as a test target).

## Safety rules built into the tools

| Rule | Where it is enforced |
| --- | --- |
| Only one hosted project can ever be written to: the one the PM names in `staging/approved-target.json` (ref, URL, approver, dates, operations; at most 60 days; no secrets). Without that file every hosted script refuses. Production is refused even if named. | `lib/approved-target.mjs`, called before any connection by `load.mjs`, `security/owner-check.isolated.mjs`, `concurrency/two-connection.isolated.mjs`, `staging/check-build-target.mjs` |
| The operator retypes the ref for every run: `E0_CONFIRM_PROJECT_REF=<ref>` | same |
| Connection strings are parsed, not searched: only `db.<ref>.supabase.co:5432` as `postgres`, or a Supabase pooler host as `postgres.<ref>`. TLS is always verified against the project's CA file. | `refOfDbUrl`, `load.mjs` |
| Inputs are pinned: full commit SHAs only; the workspace manifest records sha256 of every file, the lockfile and tool versions | `build-baseline.mjs` |
| Writes happen only after a saved dry run that is byte-identical to the plan recomputed at apply time (target, approval, manifest hash, every file hash) | `load.mjs plan` / `apply --plan` |
| The baseline loads only into a project with no public tables, in ONE transaction that ends with containment | `load.mjs` |
| No scheduled job ever runs; no secret can be stored; every outbound path is known and needs an absent secret; nothing has been sent | `containment/contain.sql`, `containment/check.sql` |
| A hash match is never presented as more than its coverage | `compare.mjs`, `detect-stack.mjs` print the covered and NOT covered lists every time |

### Outbound integrations and scheduled jobs (contained)

Verified in the reconstruction (main + stack, 2026-11-15):

* **One function makes outbound calls: `notify_user(uuid,text,text,jsonb)`.** It posts to **production's**
  `https://dmlkjpjubneqhbqoxlct.supabase.co/functions/v1/send-push`. It sends only if
  `private.secrets` holds `internal_push_secret`; otherwise it logs a warning and returns. In the isolated project
  `private.secrets` is emptied and sealed by a trigger, so the secret cannot be stored even by mistake. The URL
  is left unchanged on purpose (changing it would change the definition being compared).
* **Six pg_cron jobs** (`daily-prompt`, `good-morning-treat` every 15 minutes, `inactivity-reminders`,
  `purge-expired-place-cache`, `weekly-digest`, `weekly-suggestions`). Containment sets every job inactive inside
  the load transaction, and a trigger forces any job created later (for example by a pending migration) inactive.
  `compare.mjs --contained-second` reports these as "contained" and accepts no other difference.
  (Correction: the previous checkpoint reported nine jobs; three were duplicates produced by the test stub.)
* **Edge Functions are not deployed to the isolated project** (Lovable deploys only to production). Apple Maps
  search, push and anything else behind an Edge Function do not work there unless the PM separately decides to
  deploy them with the isolated project's own keys. Production's Apple Maps token, push keys, service-role key and
  `internal_push_secret` are never copied, in any form.
* **Auth email**: create the test accounts by hand in the isolated project (Authentication → Users → Add user,
  auto-confirm) with addresses on a domain the PM controls. Do not import production users.

## The sequence

| Step | Where | Who | Writes to |
| --- | --- | --- | --- |
| 1. Production fingerprint | Production, through Lovable, read-only | A separately authorized Lovable operator | Nothing |
| 2. Detect stack state | A laptop | Engineer | Local files |
| 3. Build the workspace | A laptop | Engineer | Local files |
| 4. Approve the target | `staging/approved-target.json` | **PM** | A local file |
| 5. Dry run, then load the baseline | Isolated project | Owner or engineer with its DB password | Isolated project only |
| 6. Containment check, export, compare | Isolated project (read-only) | Same | Nothing |
| 7. Pending stack migrations | Isolated project | Same, only when authorized | Isolated project only |
| 8. Schema A and addenda | Isolated project | Same, only when the PM approves the SQL | Isolated project only |

### 1. Production fingerprint (read-only)

The operator runs `queries/fingerprint-export.sql` in Lovable with the read-only wording from
`docs/INTEGRATION_ACCEPTANCE.md` section 2, and saves the single returned value, unedited, as
`production-<date>.json`. If Lovable cuts the value off (the result is about 200 KB), run the four
`fingerprint-export-part-N-of-4.sql` files instead and save each. A cut, edited or partial copy is rejected
by the tools; re-run rather than repair it. Also run `../security/production-diagnostics.sql` (item 6 of the
correction checkpoint) and save its results.

### 2. Detect which stack migrations production has

```sh
cd e0 && npm ci
M=$(git rev-parse origin/main); S=$(git rev-parse origin/stack/14-photo-records-owner-check)
node baseline/detect-stack.mjs production-<date>.json --main $M --stack $S --json detection.json
```

`consistent` means exactly one possible state matches every material object (89 at these commits). Anything else
prints `review` for every migration with the differing definitions, and **stops the procedure** until a person
explains each difference. A different Postgres version can print an identical definition differently: that
appears as a difference and must still be explained, never waved through.

### 3. Build the workspace (clean, pinned)

```sh
node baseline/build-baseline.mjs --out ../build/ws-<date> --main $M --stack $S --detection detection.json
```

Refuses branch names, a non-empty folder, or a detection that is not `consistent` for these exact commits.
Writes `baseline/` (main's files, nine repaired per `lib/repairs.json`, plus the stack files production has),
`pending/` (only the stack files production lacks), `containment/`, and `manifest.json` with every sha256.

### 4. The PM approves the target

Copy `staging/approved-target.example.json` to `staging/approved-target.json` and fill it in for the isolated
project. Claude does not create this file.

### 5. Dry run, then load the baseline

```sh
export ISOLATED_DB_URL='postgresql://postgres:<isolated DB password>@db.<isolated ref>.supabase.co:5432/postgres'
export ISOLATED_DB_CA=/path/to/<isolated project CA certificate>.crt     # Settings -> Database -> SSL
export E0_CONFIRM_PROJECT_REF=<isolated ref>
node baseline/load.mjs plan  --workspace ../build/ws-<date> --phase baseline > plan-baseline.txt   # read it
node baseline/load.mjs apply --workspace ../build/ws-<date> --phase baseline --plan plan-baseline.txt
```

No `supabase migration repair` step is needed: nothing is applied through the Supabase CLI, and the pending
files live in their own folder, so nothing can be applied twice. The load log in `e0_containment.load_log`
records each phase with its plan and manifest hash.

### 6. Check containment, export, compare

```sh
node baseline/load.mjs check  --workspace ../build/ws-<date>              # every row must be ok
node baseline/load.mjs export --workspace ../build/ws-<date> --out isolated-<date>.json
node baseline/compare.mjs production-<date>.json isolated-<date>.json --contained-second
```

**Baseline acceptance: zero differences other than "contained" cron jobs**, or a comparison log in
`e0/baseline/evidence/` that explains every remaining row. A match covers only the 21 categories listed in
`fingerprint.mjs` `COVERAGE`; it says nothing about data, Edge Functions, secrets, Auth configuration, Realtime
server settings or runtime behaviour.

### 7. Pending stack migrations (only when authorized)

```sh
node baseline/load.mjs plan  --workspace ../build/ws-<date> --phase pending > plan-pending.txt
node baseline/load.mjs apply --workspace ../build/ws-<date> --phase pending --plan plan-pending.txt
node baseline/load.mjs check --workspace ../build/ws-<date>
```

One transaction per file, stop at the first error, refuses a second run.

### 8. Schema A and addenda (only when the PM approves the SQL)

Not automated on purpose. Applying them to the isolated project is hosted SQL and needs its own authorization.

## Rehearsal (local, no network)

```sh
npm run test:rehearsal       # detect -> workspace -> dry run -> load -> check -> pending -> check, plus refusals
```

Rehearsed result (2026-11-15): a load from the workspace into real Postgres 16 matches the in-process Postgres 18
build in every policy, function, column, constraint, index, trigger and view. The only differences: the
`MAINTAIN` privilege (Postgres 17+) in 97 privilege rows, and the rehearsal database name in the six (inactive)
cron rows.

## Non-production app build

```sh
cp e0/staging/env.staging.local.example .env.staging.local     # the approved project's public URL and anon key only
npx vite build --mode staging
node e0/staging/check-build-target.mjs                          # must say OK: approved URL present, no production ref
npx cap sync ios
```
