# Daily notifications: what needs approval before they go live

Prepared 18 Nov 2026 for PR #25 (`feat/notifications-fun-facts-explore`). **Nothing below has been applied, deployed or merged.** The iPhone trial build uses the demo backend and needs none of it.

Three pushes a day, at local time in each user's saved timezone:

| Time | Push (`push_kind`) | Content |
|---|---|---|
| 7 AM | `good_morning_fun_fact` | "Good morning!" + an animal / world / nature / space fact (60, rotating daily) |
| 8 AM | `morning_explore` | Explore your city: one idea for today (30) |
| 5 PM | `evening_explore` | Evening city exploration (40). Cafés and restaurants appear only as places to explore. |

## A. Database changes (one migration, needs approval)

All in `supabase/migrations/20261118120000_good_morning_fun_facts_and_city_explore.sql`. It applies as one transaction and is safe to re-run.

| # | Change | Object | Access |
|---|---|---|---|
| A1 | New table | `public.daily_push_sent` (`user_id`, `push_kind`, `last_sent_date`; PK `user_id, push_kind`; FK `auth.users` on delete cascade) | RLS on, no policies: only the senders below use it. `service_role` all. |
| A2 | New table | `public.notification_opt_outs` (`user_id`, `push_kind` limited to the 3 kinds, `created_at`; PK `user_id, push_kind`; FK `auth.users` on delete cascade) | RLS: signed-in users can select, insert and delete **only their own** rows. No update. |
| A3 | New function | `send_local_time_push(text, int, text[], text[], timestamptz)`: the shared sender | `SECURITY DEFINER`; execute revoked from `anon`, `authenticated`, `public` |
| A4 | New functions | `send_good_morning_fun_fact(timestamptz)`, `send_morning_explore(timestamptz)`, `send_evening_explore(timestamptz)` | same |

**Who receives a push:** a user with at least one registered device, a saved timezone, and no opt-out row for that push. A user with **no saved timezone gets none of the three** until they next open the app, rather than being sent one at a guessed hour.

**No duplicates:** before calling `notify_user()`, the sender claims the send in `daily_push_sent` with an atomic upsert (once per user, per push, per local date). Repeated or overlapping cron runs, several devices, and date-line travel can't double-send. A user with two devices gets one push on each device.

**Retries:** an error inside the database call is retried on the next 15-minute run. Delivery problems after the request leaves the database (APNs) aren't retried; `pg_net` is fire-and-forget. That's the same as every existing notification.

Not changed: `notify_user()`, `device_tokens`, the `send-push` Edge Function, all social notifications (follows, shared lists, friend visits), `send_good_morning_treat()`, `send_daily_prompt()` and `good_morning_sent`. The last three stay in place for rollback.

## B. Scheduler (pg_cron) changes (same migration, needs approval)

| # | Job | Before | After |
|---|---|---|---|
| B1 | `good-morning-treat` (8 AM local treat push) | every 15 min | **removed** |
| B2 | `daily-prompt` (food prompt, 11 PM UTC for everyone) | `0 23 * * *` | **removed** |
| B3 | `good-morning-fun-fact` | — | **new**, `*/15 * * * *` |
| B4 | `morning-explore` | — | **new**, `*/15 * * * *` |
| B5 | `evening-explore` | — | **new**, `*/15 * * * *` |

Every 15 minutes, so every timezone (including +5:30, +5:45 and +12:45 offsets) is covered inside its 7, 8 and 17 o'clock hour. The claim in A makes the extra runs no-ops.

**Not touched; decision needed (C4):** `weekly-suggestions` (Mon 15:00 UTC), `weekly-digest` (Mon 16:00 UTC), `inactivity-reminders` (daily 17:00 UTC, to users quiet for 7+ days, at most weekly). With them, some days have more than three scheduled pushes.

## C. Not database, but required before anyone actually receives these

| # | Item | Why | Approval area |
|---|---|---|---|
| C1 | Confirm delivery works end to end: `private.secrets` row `internal_push_secret`, and the `send-push` secrets `INTERNAL_PUSH_SECRET`, `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_ENV=production`. Then send one test push. | None of these is confirmed set (see `src/lib/pushPrompt.ts`). Without them, `notify_user()` logs a warning and sends nothing. | Edge Function / secrets |
| C2 | Turn on the permission ask (`PUSH_PROMPT_ENABLED = true`) in an app release | The current app **never asks** for notification permission, so only phones that allowed it in an older build could receive anything. Needs a new App Store build. | App release |
| C3 | Update App Store materials: `docs/APP_REVIEW_NOTES.md` ("does not ask for notification permission"), `docs/APP_PRIVACY_LABELS.md` (Device ID for push tokens), and the Privacy page (mention Profile › Notifications) | They currently say no notifications and no push tokens | App Store / legal |
| C4 | Decide on the three older scheduled pushes (B, note above): keep, pause, or fold into the three daily ones | "Three per day" | Product |
| C5 | Decide the default: daily pushes **on** for anyone who allows notifications, with per-push switches in Profile (as built), or off until switched on | Apple guideline 4.5.4 requires explicit opt-in for promotional pushes. These are content suggestions, not ads, but the permission ask should mention them either way. | Product / App Review |

## D. Read-only checks to run in Lovable first

Paste this sentence above each query, and decline any "Apply" or migration offer:

> Run this read-only SQL query against the Cloud database exactly as written and show me the full result table. It only reads. Do not create a migration, do not change anything, and do not "fix" anything it shows.

```sql
-- READ ONLY: current scheduled jobs (expect good-morning-treat, daily-prompt, weekly-*, inactivity-reminders)
SELECT jobname, schedule, active, command FROM cron.job ORDER BY jobname;
```
```sql
-- READ ONLY: extensions the migration relies on (expect both)
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net');
```
```sql
-- READ ONLY: names the migration creates must not exist yet (expect two nulls)
SELECT to_regclass('public.daily_push_sent') AS daily_push_sent, to_regclass('public.notification_opt_outs') AS notification_opt_outs;
```
```sql
-- READ ONLY: is delivery configured? (C1)
SELECT EXISTS (SELECT 1 FROM private.secrets WHERE name = 'internal_push_secret') AS internal_push_secret_set;
```
```sql
-- READ ONLY: who would receive pushes today
SELECT count(DISTINCT d.user_id) AS users_with_device,
       count(DISTINCT d.user_id) FILTER (WHERE p.timezone IS NOT NULL) AS with_saved_timezone,
       count(DISTINCT d.user_id) FILTER (WHERE p.timezone IS NULL) AS without_timezone_skipped
FROM public.device_tokens d LEFT JOIN public.profiles p ON p.user_id = d.user_id;
```

## E. Order and rollback

1. Run D, then C1 (one test push to your own phone).
2. Apply the migration (A + B) through Lovable as one migration. The current App Store app doesn't read the new tables, so applying it is safe with the app as it is.
3. The Profile › Notifications card ships in the app. It hides itself until the tables exist, so the app can ship before or after step 2.
4. C2 and C3 ship together in the next App Store build.

**Rollback**: no data loss; the new tables can stay.
```sql
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('good-morning-fun-fact', 'morning-explore', 'evening-explore');
SELECT cron.schedule('good-morning-treat', '*/15 * * * *', $$ select public.send_good_morning_treat(); $$);
SELECT cron.schedule('daily-prompt', '0 23 * * *', $$ select public.send_daily_prompt(); $$);
```

## F. What was verified (locally, never on a hosted database)

`supabase/tests/daily-notifications/run.sh` uses a throwaway Postgres 16 with stand-ins for `cron` and `notify_user`:

- users in 13 timezones (including +5:30, +5:45, +12:45, −3:30, +14 and −11), plus no timezone, an invalid timezone, no device, two devices, and an opt-out
- every 15-minute tick simulated over 33 days spanning the 2026 US, EU and Australian clock changes

Results:
- Every push went out at exactly 7:00, 8:00 or 17:00 local time.
- None was duplicated and none was missed.
- Opt-outs were respected per push.
- Users with no timezone, an invalid timezone or no device got nothing.
- Travel follows the newly saved timezone, still once per local date.
- A failed call is retried once on the next run.
- Overlapping runs don't double-send.
- Users can only see and change their own opt-outs, and can't trigger sends or read send history.
- The migration applies cleanly twice.
