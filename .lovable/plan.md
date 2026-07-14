## Goal

Bring this project's Lovable Cloud backend in line with the synced files: apply the pending push-notification migrations, deploy the `send-push` edge function, and confirm the required Postgres extensions. No frontend, `ios/`, or `capacitor.config.ts` changes.

## Sync re-check result

The GitHub sync is intact — all the files are present in the working tree (my initial glance missed the two newest files because the first listing was stale). What's actually out of date is the **database**: the migration files exist but were never applied here. Verified against the live DB:

- `device_tokens` table — missing
- `notify_user()` + follow/shared-list trigger functions — missing
- follow / shared-list notification triggers — missing
- `engagement_reminders` table, `private.secrets` table, `send_weekly_digest()` / `send_inactivity_reminders()` — missing
- `pg_net` and `pg_cron` extensions — already enabled

So three migrations need to be applied, in timestamp order.

## Plan

### 1. Apply `device_tokens` migration (`20260713162528`)
Creates `public.device_tokens` (one row per device install, unique token, ios/android), with owner-scoped RLS policies, index, grants, and an `updated_at` trigger. This must go first because the cron functions read from it.

### 2. Apply push-trigger migration (`20260714020628`)
- Creates the `private` schema + `private.secrets` table (locked down, no policies, RLS on).
- Creates `public.notify_user(user_id, title, body, data)` — a `SECURITY DEFINER` helper that calls the `send-push` edge function via `net.http_post`.
- Adds follow triggers (`notify_on_follow_insert`, `notify_on_follow_accepted`) and the shared-list trigger (`notify_on_shared_list_item_insert`), with `EXECUTE` revoked from `anon`/`authenticated`/`public`.

### 3. Apply scheduled-push migration (`20260714020715`)
- Creates `public.engagement_reminders` (per-user cooldown bookkeeping).
- Creates `send_weekly_digest()` and `send_inactivity_reminders()`.
- Schedules two `pg_cron` jobs: weekly digest (Mon 16:00 UTC) and daily inactivity check (17:00 UTC, with a 7-day per-user cooldown enforced inside the function).

### 4. Deploy the `send-push` edge function
Code already exists at `supabase/functions/send-push/index.ts` and is registered in `config.toml` (`verify_jwt = true`). Deploy it and confirm it comes up.

### 5. Confirm extensions
`pg_net` and `pg_cron` are already enabled, so the `CREATE EXTENSION IF NOT EXISTS` statements are no-ops. I'll confirm again after applying and flag if anything regresses.

## Important caveats to resolve after applying

These don't block the migrations but mean pushes won't actually fire end-to-end yet:

1. **`private.secrets.service_role_key` cannot be populated on Lovable Cloud.** `notify_user()` reads the service-role key from that table to authenticate its call to `send-push`. The migration intentionally does not write the value (it expects a manual SQL-editor insert), and on Lovable Cloud the service-role key isn't accessible to you or me. Until that row exists, `notify_user()` logs a warning and skips — triggers/cron run harmlessly but send nothing. I'll recommend a Cloud-compatible alternative (e.g. having `notify_user` use the internal function invocation / a stored secret we can set) once the schema is in.

2. **APNs secrets are not set.** `send-push` needs `APNS_KEY`, `APNS_KEY_ID`, and `APNS_TEAM_ID` (bundle id defaults to `com.afiyeat.app`). Without them the function deploys but returns an error on send. You'll need to provide these when ready to actually test on a device.

## Out of scope
No changes to `ios/`, `capacitor.config.ts`, frontend code, or any auto-generated Supabase files.

## Technical notes
- Migrations are idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`, `cron.schedule` upserts by name), so re-applying via the migration tool is safe.
- Applied strictly in timestamp order: `…162528` → `…020628` → `…020715` to satisfy dependencies (`device_tokens` before cron functions; `notify_user` before the triggers/cron that call it).
