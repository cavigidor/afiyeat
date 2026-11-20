# Lists V2 on your iPhone with your real lists: the staging path

Status: **PROPOSAL, nothing applied.** Every step that touches a hosted project needs the PM's approval
first. Production is only ever *read*, and only by you, signed in as yourself.

## Why the trial app showed sample data

"Afiyeat Trial" is built with the in-app demo backend (`npm run build:demo`). It never talks to any
Supabase project, so signing in with your real account still shows the demo fixtures. That is by design
(it can't touch production), but it can't test your existing data either. This folder adds the missing
path: **a copy of your own data in a separate staging project, opened by a separate app, "Afiyeat Staging".**

```
production (read-only, as you) ──export──▶ folder on your Mac ──import──▶ STAGING project ◀── "Afiyeat Staging" (iPhone)
                                                                      │
                                                    compare-staging.mjs (before/after, read-only)
```

## What it copies, and what it never copies

| Copied, unchanged, with original ids | Replaced or left out |
|---|---|
| Your lists, statuses, categories, items (every field, including hidden notes/price/rating) | Passwords, sessions, tokens, push/device tokens, email codes |
| Your item photos and My Restaurants photos (same bucket, same path, sha256-checked) | Anyone's email address; other people's profiles |
| Your My Restaurants, folders, profile settings (no referral code, no avatar) | Other people's ids → unlinkable pseudonyms ("Member 1") |
| Your shared lists, follows, blocks (the other side pseudonymised) | Other people's shared-list places → "Place added by Member 1 #ab12", no address/location/note |
| Each member's *private / public* setting (needed for privacy tests) | Other people's comments → "[comment by Member 1]"; their photos and lists |

## Staging changes that need your approval (none applied)

| # | Change | Where | Why |
|---|---|---|---|
| S1 | Create a new, empty Supabase project, e.g. `afiyeat-staging` (you own it; free tier is enough) | supabase.com, your account | A target that is not production. Lovable Cloud's own project can't be duplicated safely. |
| S2 | Write `qa/compat/staging/approved-target.json` (template: `approved-target.example.json`) naming that project, ≤ 60 days, operations `load-own-data`, `snapshot`, `iphone-build` | your Mac | The tools refuse every hosted write without it, and refuse production even if named. Claude does not create it. |
| S3 | Load production's schema baseline into staging with the existing E0 tooling (`e0/baseline`, branch `e0/b-isolated-backend`): fingerprint (Lovable, read-only) → detect → dry run → load → containment check | staging only | Same tables, functions, RLS and triggers as production on the snapshot date. Containment disables every scheduled job and seals the push secret, so staging can't send pushes or call production. |
| S4 | Create the private `custom-list-images` bucket in staging with production's settings (from query Q2) | staging only | main's migrations never create it (production's was made outside migrations); restaurant-images *is* created by migrations. |
| S5 | Apply the five pending migrations (#7, #8, #10, #13, #14) to staging, in order | staging only | Lists V2 needs #8 and #10 (see the report). This is the exact release order proposed for production. |
| S6 | Run `export-own-data.mjs` on your Mac (you type your production email and password; read-only allowlist) | reads production as you; writes a folder on your Mac | Your real lists and photos. |
| S7 | Run `import-own-data.mjs` (you type the **staging** service_role key and choose a staging password) | staging only | Creates your staging sign-in with your production user id (photo paths start with it), member placeholders, every row, every photo; verifies field by field. |
| S8 | Run `prepare-iphone-staging.sh <commit> <.env.staging.local>` and install "Afiyeat Staging" from Xcode | your Mac + iPhone | Separate app `com.afiyeat.app.staging`; checks the build names staging, not production, not demo. |
| S9 | Optional, separately: deploy the `apple-maps-*` Edge Functions to staging with a **staging-only** MapKit key | staging only | Without it, place search and map tiles don't work in Afiyeat Staging (typed names still do). Production keys are never copied. |

Not proposed: copying production's whole database (Lovable's export includes every user's data and password hashes), pointing any test build at production, or deploying anything to production.

## Commands (after S1–S5)

```sh
cd afiyeat && git fetch origin && git checkout qa/lists-v2-data-compat && cd qa/compat/staging

# S6: read-only export of YOUR data (new folder, kept on your Mac)
node export-own-data.mjs --out ~/AfiyeatStaging/export-$(date +%F)

# S7: load it into staging only
export STAGING_CONFIRM_PROJECT_REF=<staging ref>
node import-own-data.mjs --bundle ~/AfiyeatStaging/export-<date>

# S8: the iPhone app (same commit that passed the lab suite)
bash prepare-iphone-staging.sh 4973aa7216e7e147966c1c86b79161144d2d8395 ~/AfiyeatStaging/.env.staging.local

# after testing on the iPhone (read-only)
node compare-staging.mjs --bundle ~/AfiyeatStaging/export-<date> --label after-iphone
```

`compare-staging.mjs` writes `compare-after-iphone.md`: every exported row's fate (deleted / changed field by
field / unchanged), lists whose name, icon, owner or field settings changed, and whether every photo is
still present. Your own edits on the phone show up as changes; anything you didn't do is a finding.

## What to try on the iPhone (Afiyeat Staging)

1. Lists screen: every list with the item count you know from the real app.
2. Open each kind of list (places, wines/manual price, books/long notes, a legacy list without statuses).
3. Add Item (typed name) in a places list and in a non-place list.
4. Edit an item in a list that **hides** Notes (or Price/Rating): change only the name, save. The hidden value must survive.
5. Customize a list: hide Price, then show it again. Prices must come back.
6. Add a 2nd photo to an item that already has one; try picking 6+ photos (cap at 5).
7. Shared list: opens, both "To Go" and "Been There" tabs, your partner shows as Member 1.
8. Who can see it: change a list to Only me, then back.
9. Run `compare-staging.mjs` and check the report.

## Rehearsed in the lab (no hosted project involved)

`qa/compat/lab/rehearse-staging.mjs` runs S5–S8's data steps end to end against local stand-ins
("prodsim" = production's current schema with the representative data; "stagingsim" = main + the five
pending migrations, empty): **19/19 checks passed** on 2026-11-20 — the export changed nothing in the source,
made only read requests, held all 11 lists / 79 items and nothing of anyone else's, no other person's id,
email, username or name, and the redactions held; the import put every row in staging with its original id
and values (the one follow a trigger forced to "pending" was restored; only the profile's `updated_at` is
re-stamped by a trigger), uploaded and verified 10/10 photos (the 11th is missing in the source too), and the
new app showed all 11 lists; the comparison found 0 deleted rows and all photos present.

The iPhone build script was dry-run on Linux with a placeholder project (all build-target checks passed;
the Xcode steps only run on a Mac) and refuses: no approval, wrong retyped ref, a production approval,
a production URL in the env file, and a service_role key in the app.
