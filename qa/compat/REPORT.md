# Lists V2 data compatibility: acceptance checkpoint report

Date: 2026-11-20 · Branch `qa/lists-v2-data-compat` · Nothing merged, deployed or applied to any hosted database.

**Old app** = `main` 9baf34e (what the App Store has today) · **New app** = trial 4973aa7 (Lists V2 + notifications/photo fixes, the same commit the iPhone trial was built from) · **Pending migrations** = the five integration files from 4973aa7:
#7 `custom_list_items_owner_check`, #8 `list_visibility_and_anonymous_discovery`, #10 `discovery_places`, #13 `custom_list_images_owner_folder`, #14 `photo_records_owner_check`.

## Bottom line

* **Existing data survives.** Applying the five migrations to production's schema added three columns and changed **no existing row** (counts identical, 0 deleted, 0 changed). Every list kept profile-based visibility. Both apps then read the same lists, items, statuses, categories, photos and shared lists; no existing row was deleted or converted at any point, and all 81 pre-existing items kept their id, list link, status and categories.
* **Lists V2 must not ship before #8 and #10 are in production.** On today's schema V2 loads lists and adds items, but "Who can see it" fails (the `visibility` column is missing). Release order: migrations first, then the app. The old app works on the migrated schema, so it is safe to migrate first.
* **Hidden-field fix confirmed.** Lists V2 keeps a hidden note when an item is edited. The **current** app erases it (a pre-existing bug, reproduced), and will keep doing so for anyone on the old version.
* **Not yet proven on real data.** The tests used a synthetic copy built to production's exact schema and the old app's own presets, not production rows. The staging path that puts **your real lists** on your iPhone is built and rehearsed. Running it needs your approval for staging steps S1–S9 (below).

## 1. Live production schema: read-only inspection (2026-11-19)

These were zero-row probes with the public key. They return column and function existence, never data. Evidence: `evidence/live-probes-2026-11-19.md`.

| Dependency of Lists V2 | Live production | Needed for |
|---|---|---|
| All 57 table/column sets the old and new app select | present | everything |
| `custom_lists.visibility`, `custom_lists.discovery_token`, `content_reports.via_anonymous` (#8) | **absent** (42703) | Who can see it, discovery links, anonymous reports |
| `get_discoverable_list`, `get_list_discovery_preview`, `report_discoverable_list`, `can_view_custom_list` (#8) | **absent** | shared discovery links |
| `get_discovery_places(p_mode)` (#10) | **absent** (404; `is_moderator` control answers 401) | Home/Explore (V2 falls back to today's `get_explore_places`, verified) |
| `notification_consents` (PR #25) | absent, as expected | notification opt-in (separate approval) |
| Policies changed by #7, #13, #14 | **not determinable with the public key** | owner checks |

So #8 and #10 are **not** in production. The state of #7, #13 and #14 needs query Q1 of the read-only pack. Expected rows are in `production/expected-policies.md`.

Pre-existing, not caused by V2: a signed-out request to `custom_lists`, `custom_list_items`, `restaurants` or `recipes` gets HTTP 401 "permission denied for function is_moderator".

## 2. Old and new app against the same data (lab)

The lab ran a local Postgres 16 with production's schema, rebuilt by replaying main's 77 migrations. It ran the real PostgREST, plus a local auth and storage gateway where storage RLS decides every photo. Both apps were built unmodified, except that they point at the lab. Every request leaving the machine was blocked and recorded. Final run: `results/2026-11-20T05-37-20-496Z/` reported **49 PASS · 1 FAIL · 1 PRE-EXISTING · 2 INFO**. The suite was run several times. The final run started from a clean lab state.

**Representative data.** The seed had 6 accounts:

| Account | Role in the tests |
|---|---|
| Ayla | public owner |
| Bora | mutual follower |
| Cem | private account |
| Deniz | stranger with a pending follow request to Cem |
| Ece | shared-list partner |
| Fikret | blocked |

The data covered 14 lists, 28 statuses, 5 categories, 81 items, 7 item photos (stored both as old full URLs and as bare paths, plus one missing file), 5 restaurants with photos, 42 folders, a shared list with items and comments, and 11 storage objects. The lists included:

* each old-app preset, with its exact field flags
* a list whose Notes are hidden but whose items still hold notes
* a legacy list with no status rows
* an empty list
* a 60-item list
* manual price and rating values
* long notes, emoji and Turkish characters

| Phase | What was checked | Result |
|---|---|---|
| P1 old app, today's schema | 11 lists, 78 items with correct counts; 6 list types open; reading changes nothing | PASS |
| P2 old app writes | Add Item; edit a note and add a photo; no other row touched | PASS |
| P2 old app writes | Edit an item in a Notes-hidden list: **the old app erases the hidden note** ("HIDDEN-NOTE: try the cake" → null) | **PRE-EXISTING** bug, live today |
| P3 apply #7 #8 #10 #13 #14 | All 5 apply. The only changes are new columns (`visibility`, `discovery_token`, `via_anonymous`). 14/14 lists get `profile`, each with a unique token. Row counts identical; 0 rows added, deleted or changed. | PASS |
| P4 privacy, before vs after | 7 viewers × 13 tables return the same rows. The private account, the blocked user, the shared list and photo signing all behave the same. | PASS |
| P4 privacy | The only difference: signed-out reads of `restaurant_images` go from 0 rows to HTTP 401. #14 makes that policy check the parent restaurant, which signed-out visitors already can't read. Same visibility, different error. | INFO |
| P5 old app, migrated schema | Lists, counts, Add Item, no failed calls | PASS |
| P6 new app, migrated schema | Lists home: 11 lists with counts. All 7 list types account for every item. Photos load in both stored formats. | PASS |
| P6 new app writes | Quick add lands in the current status. **Editing in a Notes-hidden list keeps the note** ("HIDDEN-NOTE: get the profiterol"). Hiding Price keeps every price. A new photo keeps the old ones (2 → 3). | PASS |
| P6 new app | Nothing else changed (9 expected changes, 0 unexpected). Shared list shows both members' items. A stranger sees nothing of the private list. No failed calls. | PASS |
| Whole run (seed → end) | 0 rows deleted in any table. No list converted (name, icon, owner, created_at and field flags unchanged, apart from the one Price toggle the test made). 81/81 item ids, list links, status and category links intact. | PASS |
| P7 new app, today's schema | Lists load (11/11). Home/Explore fall back correctly. Add Item works. Nothing deleted. | PASS |
| P7 new app, today's schema | **"Who can see it" fails** ("Couldn't change who can see it. Nothing was changed.", 400). The column comes from #8. | **FAIL**: release blocker unless #8 ships first |

Expected changes recorded during the run:
* Every app open re-saves the signed-in user's timezone. The value doesn't change, but `profiles.updated_at` moves. The old app does the same.
* A follow inserted by the seed was set to accepted, because the follow trigger always makes it pending.

Record comparison (`results/.../diff-whole-run.json`):

| Table | Before → after | Added | Deleted | Changed rows |
|---|---|---|---|---|
| custom_lists | 14 → 14 | 0 | 0 | 1 (Price toggle by the test) + 2 new columns |
| custom_list_items | 81 → 84 | 3 test adds | 0 | 3, all from test edits: Petra note (old app), Divan note erased (old-app bug), Savoy name (V2) |
| custom_list_item_images | 7 → 9 | 2 test photos | 0 | 0 |
| storage.objects | 11 → 13 | 2 test photos | 0 | 0 |
| profiles | 6 → 6 | 0 | 0 | 2 (`updated_at` only, timezone re-save) |
| every other table | identical | 0 | 0 | 0 |

## 3. Backup (proposal, nothing done)

Lovable Cloud keeps a daily backup for about 14 days; a restore rolls back the entire database (schema and data) and cannot be undone. Separately, "Export project data" makes a full database copy (a pg_dump that includes every user's data and password hashes) saved to the project's Cloud storage. Storage files are not in either and are downloaded from Cloud → Storage.

Proposed: immediately before the production migrations, you (not Claude) run **Export project data** and download it to private storage, and note the time of the latest daily backup. This export is never loaded into staging and never shared, because it holds every user's data and credentials.

The five migrations change policies, not files, so a storage download is optional.

A full restore would also lose everything users wrote after the backup, so the better rollback for these additive migrations is a reverse script per migration. That script isn't written yet (see section 6).

## 4. Your real data on your iPhone: "Afiyeat Staging" (ready, needs approval)

The trial showed sample data because it's built on the demo backend, which never contacts any server. The new path, in `staging/README.md`:

1. **Read-only export of your own data.** You sign in on your Mac. An allowlist permits only sign-in/out, GET reads and signed photo downloads.
2. **Import into a separate staging project you own.** Your production user id is kept, so photo paths stay exact. Every row is checked field by field and every photo by sha256. Other people become "Member N"; their places and comments are redacted.
3. **Install "Afiyeat Staging"** (`com.afiyeat.app.staging`), built from 4973aa7 against the staging project only.
4. **Compare after testing.** A read-only before/after report of every exported row and photo.

Rehearsed end to end in the lab: **19/19 checks passed** (`results/staging-rehearsal-2026-11-20/`).
* The source was unchanged and only read requests were made.
* 11/11 lists and 79/79 items were exported, and none of another person's ids, emails, usernames or names appeared.
* Every row landed with its original id and values. A trigger forced one follow to pending; it was restored. Only the profile's `updated_at` gets re-stamped.
* 10/10 photos were verified. The 11th is missing in the source too.
* V2 showed all 11 lists, and the comparison found 0 deletions.

The iPhone build script was dry-run (all build-target checks passed). It refuses a missing or expired approval, production, a service_role key in the app, and any extra setting.

## 5. What remains unverified

| Item | Why | How to close it |
|---|---|---|
| Real production data shapes | The seed is synthetic. It's modelled on the schema and the old app's presets, not on real rows. | Q3 (counts only) in `production/readonly-pack.sql`, then staging S6–S8 with your own data |
| Whether #7, #13, #14 are already live | Policies can't be read with the public key | Q1 vs `production/expected-policies.md` |
| Existing rows the new owner checks would reject (#7/#14), photo objects outside their owner's folder (#13) | Needs production rows | Q3 `rows_the_new_owner_checks_would_reject` |
| Items that already have more than 5 photos | Seed max is 2. V2 hides "add" at 5 and shows e.g. 6/5. Saving such an item wasn't tested. | Q3 `items_with_over_5_photos`. If > 0, add a lab case before release. |
| `custom-list-images` bucket settings | main's migrations never create this bucket | Q2 |
| Edge Functions (Apple Maps search and tiles, push, email) | Not in the lab or staging | Production smoke test after release, or S9 |
| Native iOS behaviour on your data (WKWebView, photo picker, offline) | The lab used headless Chrome | Afiyeat Staging on your iPhone |
| Concurrency (two devices editing at once) | Not in scope of this checkpoint | e0 two-connection test on staging |
| PR #25 notifications migration | Separate approval track | `docs/NOTIFICATIONS_GO_LIVE.md` |

## 6. Production changes that would eventually need your approval

Nothing below has been done. In order:

1. Run the read-only pack **Q1–Q4** in Lovable with the read-only wording. It is read-only, but it is an operator action in production.
2. **Export project data** (backup) and note the latest daily backup, just before step 4.
3. Write and test **reverse scripts** for #7, #8, #10, #13 and #14 in the lab. I can do this next. It needs no approval, since it is lab-only.
4. **Apply the five pending migrations to production, in order (#7 → #14)**, through Lovable. Required before any Lists V2 build is released. The old app keeps working afterwards (P5).
5. Regenerate Lovable's Supabase types, then **merge Lists V2** to `main`.
6. **Submit the Lists V2 build** to the App Store.
7. Separately: the PR #25 notification migration, scheduler changes and Edge Functions (already listed in `docs/NOTIFICATIONS_GO_LIVE.md`).
8. Decide how to handle the old app's hidden-note erasure for people who don't update. Options: a minimum-version prompt, or a server-side guard proposed for review. The second would be another migration.

Staging steps S1–S9 (in `staging/README.md`) need your approval too, but touch only a staging project you create.

## Reproduce

```sh
git worktree add qa/compat/old 9baf34e0b287b7dbb6b11909a1b509693cbcede0 && git worktree add qa/compat/new 4973aa7216e7e147966c1c86b79161144d2d8395
(cd qa/compat/old && npm ci) && (cd qa/compat/new && npm ci) && (cd qa/compat/lab && npm ci)
# PostgREST 12.2.3 static binary at qa/compat/postgrest; Postgres 16 at /usr/lib/postgresql/16/bin
cd qa/compat/lab && node db.mjs start && node db.mjs build baseline --main 9baf34e0b287b7dbb6b11909a1b509693cbcede0 && node stack.mjs build-apps
node compat-suite.mjs          # ~3 min -> ../results/<run>/report.md
node rehearse-staging.mjs      # ~1 min -> staging path rehearsal
```

## Update 2026-11-20: own-data check (supersedes the staging path for the initial check)

The staging path in section 4 is not needed for the initial check.

**Production read-only checks (Lovable Chat mode, read-only role).** Details are in `evidence/lovable-readonly-2026-11-20.md`.
* None of the five pending migrations is live in production.
* Across all users, production holds 5 lists, 15 items and 4 item photos, plus 238 places and 167 photos.
* There are 0 shared lists, 0 categories and 0 hidden values.
* No row breaks the new owner checks.

**Own-data export.** The PM's account was exported read-only to his Mac:
* 2 lists and 14 items
* 188 places with 159 photos
* 6 folders and 12 follows

The export's counts equal production's counts for that account.

**Local run (`lab/own-data-suite.mjs`):** 30 PASS, 1 PRE-EXISTING, 0 FAIL.
* 391 rows were checked: 0 deleted, 0 lists converted, 163/163 photos still stored.
* The migrations changed no existing row.
* Privacy is identical before and after for 12 viewers.
* Lists V2 rendered all 159 photos on 66 Been There places, including a place with 10 photos. Saving that place unchanged kept all 10.

**PRE-EXISTING:** editing a Been There place re-stamps `visited_at` to now. EditRestaurantDialog does this in both the old app and Lists V2.

**Minimum before release:**
1. Back up, then apply the 5 migrations (approval needed).
2. Run a 15-minute TestFlight check on the PM's own account.
3. Re-export and compare.
4. Submit to the App Store.

Hosted staging is needed only if no pre-release build may touch production.
