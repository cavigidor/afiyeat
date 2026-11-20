# Lists V2 release runbook (release candidate `release/lists-v2-rc1`)

Nothing in here has been run against production. Each production step needs the PM's separate authorization.

## What the release candidate contains

`release/lists-v2-rc1` builds on `main` 9baf34e. In stack order, it contains:

| Layer | Contents |
|---|---|
| `stack/base` | PR #1 navigation, PR #12 listing photos, PR #13 list-photo folder rule |
| `stack/7` | Universal Add Item |
| `stack/11` | Add to a list from Home |
| `stack/8` | Per-list visibility and discovery |
| `stack/10` | Discovery categories |
| `stack/14` | Photo records owner check |
| PR #20–#23 | Lists V2 checkpoints 0–3, including keeping hidden values on edit |
| PR #25, photo part only | 5-photo cap, native capped iPhone picker, cap note |
| Fix | Editing a Been There place keeps its original visit date (`visited_at`) |

Two things are **not** in the release candidate:

- **PR #24** (custom-field database proposal).
- **PR #25's notification activation.** That covers the daily-push migration, the consent card, the first-launch permission prompt, and the scheduler. Push behaviour stays exactly as it is in the live app today.

Verification on the release candidate:

- Typecheck passes and the full test suite passes (406 tests).
- The production build passes, with no reference to `notification_consents`.
- The lab compatibility suite against the release candidate gives the same result as the accepted checkpoint: 49 pass. The only failure is "Who can see it" on the un-migrated schema, which is why the migrations go first.

## 1. Before migrating (read-only, plus your backup)

1. **Rotate the exposed Afiyeat password first.** Do this before any live-account work.
2. **Back up.** In Lovable, open Cloud, then Database, then **Export project data**.
   - Download the file to private, encrypted storage. Don't share it: it holds every user's data and password hashes.
   - Note the time of the latest automatic daily backup.
3. **Record today's counts.** In Lovable, use **Chat** mode with the read-only wording to run `pre-migration-counts.sql`. Save the result.
4. **Capture the rollback.** In the same Chat mode, run `capture-restore-script.sql` (read-only). Save its single output value as `restore-<date>.sql` on your Mac.
   - Rehearsed in the lab: migrate, then run the generated restore. Security rules, functions, grants and triggers came back identical to before. Re-applying the migrations afterwards gave the same result as the first apply.

## 2. Apply the five migrations, in this order

Apply them in **Build** mode, one message per file. Use this wording:

> Apply this SQL exactly as written, byte for byte. Do not rewrite, rename or restructure anything. If any statement fails, stop and show me the exact error instead of substituting your own version.

| # | File (`supabase/migrations/`) | What it does |
|---|---|---|
| 1 | `20261029120000_custom_list_items_owner_check.sql` | Items can only be added to or moved into your own lists |
| 2 | `20261030120000_list_visibility_and_anonymous_discovery.sql` | Adds `visibility`, which defaults to `profile` (today's behaviour), plus `discovery_token` and the discovery functions |
| 3 | `20261109120000_discovery_places.sql` | Adds `get_discovery_places` for Home and Explore |
| 4 | `20261109180000_custom_list_images_owner_folder.sql` | List-photo uploads can only go into your own folder |
| 5 | `20261111120000_photo_records_owner_check.sql` | Photo records can only be attached to your own place or item |

Properties of the five migrations:

- **They only add.** They create columns with defaults and replace security rules and functions. No row is updated or deleted.
- **They are safe to run twice.** A second run changes nothing; this was verified in the lab.
- **Nothing existing conflicts with them.** Production's read-only check found 0 rows that conflict with the new owner checks.
- **The live app keeps working.** It was tested on the migrated schema with your real data.

## 3. Immediately afterwards (read-only)

1. Run `post-migration-checks.sql` in Chat mode.
   - **Every value under `checks` must be `true`.**
   - Every number under `counts` must be at least the pre-migration count.
2. In the **live App Store app** on your iPhone, check that:
   - your lists open with the right counts;
   - My Restaurants shows the right counts;
   - a place's photos load.

   These confirm the live app is unaffected.
3. If any check is false or the live app misbehaves, go to section 4. Don't continue to TestFlight.

## 4. Recovery plan

Escalate only as far as the problem needs.

| Situation | What to do | What it costs |
|---|---|---|
| A migration fails part-way | Each file runs as one transaction. Stop and keep the error message. The failed file left nothing behind, and the earlier files are safe to keep, because the live app works with them. | Nothing |
| Checks fail, or the live app breaks after migrating | Apply your saved `restore-<date>.sql`, using the same exact-SQL wording. It restores today's security rules and functions. It keeps the new columns, which the live app ignores. Then run `post-migration-checks.sql`: the checks should now read false, and the counts should be unchanged. | No user data lost |
| A problem shows up in Lists V2 on TestFlight | Don't submit. The database stays migrated, which is harmless for the live app. Fix the problem, rebuild and retest. | Nothing |
| Data is damaged (not expected: the migrations never change rows) | Restore only the affected rows from your Export project data file, or as a last resort restore Lovable's daily backup. The daily backup replaces the whole database, can't be undone, and loses everything written after it. | Restoring the daily backup loses everything users wrote after it |

## 5. TestFlight check on your account, then compare

Use `TESTFLIGHT_CHECKLIST.md`. Afterwards, export your data again, read-only, and compare it with today's copy:

```sh
node ~/AfiyeatTrial/own-data-tools/qa/compat/staging/export-own-data.mjs --out ~/AfiyeatTrial/own-data-after-testflight
node ~/AfiyeatTrial/own-data-tools/qa/compat/staging/compare-exports.mjs ~/AfiyeatTrial/own-data-2026-11-20 ~/AfiyeatTrial/own-data-after-testflight
```

**Pass:**

- **Rows deleted is 0.**
- **Photo files missing or changed is 0.**
- Every listed change is one you made during the test.
- The only new columns are `visibility` and `discovery_token`.

Then, with separate approval: merge, then submit to the App Store.
