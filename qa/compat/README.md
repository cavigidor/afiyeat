# qa/compat — Lists V2 data-compatibility checkpoint

QA tooling only: nothing here is part of the app build, and nothing here is applied to any hosted database.

* `REPORT.md` — the acceptance checkpoint report (what passed, failed, remains unverified, production approvals)
* `lab/` — isolated local lab: Postgres 16 + PostgREST + a local auth/storage gateway; runs the old and new app
  against the same representative data (`compat-suite.mjs`) and rehearses the staging path (`rehearse-staging.mjs`)
* `production/` — read-only Lovable query pack (Q1–Q4) and the expected policy states
* `staging/` — the real-data iPhone path: read-only own-data export, staging import, comparison, "Afiyeat Staging" build
* `evidence/` — live read-only probe results and the dependency maps of both apps
* `results/` — reports of the final runs

Never copy anything from here into `supabase/migrations/`.
