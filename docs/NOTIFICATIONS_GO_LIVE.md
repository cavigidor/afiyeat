# Daily notifications: what needs separate approval before they go live

Updated 18 Nov 2026 for draft PR #25 (`feat/notifications-fun-facts-explore`) after the PM's final decisions.

**Nothing here has been applied, deployed, merged or scheduled.** The iPhone trial build ("Afiyeat Trial") uses the in-app demo backend and needs none of it. A demo build can't verify real APNs delivery, production database compatibility or real saved user data.

## 0. Behaviour this enables

| Time (user's local) | Push | Content |
|---|---|---|
| 7:00 AM | `good_morning_fun_fact` | Title "Good morning!", one fact about animals 🐾, the world 🌍, nature 🌿 or space 🚀. 60 facts; the topic changes daily; no fact repeats within 60 days, including across 31 Dec / 1 Jan. |
| 8:00 AM | `morning_explore` | Explore your city (30 ideas) |
| 5:00 PM | `evening_explore` | Evening city exploration (40 ideas). Cafés and restaurants appear only as places to explore. 8 AM and 5 PM never suggest the same kind of activity on the same day. |

The schedule targets these local times. iOS/APNs may deliver a little later than the exact minute.

**Who receives them:** only users who (a) **explicitly opted in to that push** in Profile › Notifications, (b) have a device registered for push, and (c) have a saved, valid timezone. Nobody else does.

**Consent (App Review Guideline 4.5.4):** these are engagement/promotional pushes. They need explicit opt-in via consent language shown in the app, plus an in-app opt-out. So:
- **Default OFF for every account**, existing and new.
- **Choosing Allow in Apple's dialog does not turn them on.** It only lets the phone receive notifications (today: social ones, such as follows and shared lists).
- The consent wording, shown next to the "Daily ideas" switch:
  > Yes, send me up to three Afiyeat notifications a day: a good-morning fun fact at 7 AM and ideas for exploring my city at 8 AM and 5 PM, in my time zone. You can turn these off here at any time.

  Its version (`2026-11-18`) is stored with each consent.
- **Existing accounts and existing device tokens can't bypass it:** the senders join on `notification_consents`, and every account starts with no rows.

**Permission (app, no database change):**
- First launch shows Apple's own dialog once; no Afiyeat screen comes before it.
- Apple's dialog is never shown again. After Don't Allow, Profile › Notifications explains how to turn notifications on in iPhone Settings, with an Open iPhone Settings button.
- The app keeps the server registration in line with the current permission on launch, sign-in, account switch and every return to the foreground. A device without permission has its token removed, so nothing is sent to it.

## A. Database changes (one migration; needs approval)

File: `supabase/migrations/20261118120000_good_morning_fun_facts_and_city_explore.sql`, generated from `scripts/notifications/`. It applies as one transaction, and re-applying it is harmless (tested).

| # | Change | Details | Access |
|---|---|---|---|
| A1 | New table `public.daily_push_sent` | `user_id` → `auth.users` (on delete cascade), `push_kind`, `last_sent_date`; PK `(user_id, push_kind)`. The once-per-local-day guard. | RLS on, **no policies**. `service_role` only. Signed-in users and visitors can't read it. |
| A2 | New table `public.notification_consents` | `user_id` → `auth.users` (on delete cascade), `push_kind` (only the 3 kinds), `consent_version` (1–40 chars), `consented_at` (server time); PK `(user_id, push_kind)`. One row = consent to that push. | RLS: a signed-in user can **select, insert and delete only their own rows**. Insert is limited to `user_id, push_kind, consent_version`, so `consented_at` can't be backdated. No update. Visitors: no access. |
| A3 | New function `send_local_time_push(text, int, text[], text[], timestamptz)` | Shared sender: eligible users (consent + device + valid timezone) at local hour *h*. It claims the send in A1 with an atomic upsert **before** calling `notify_user()`, then picks the message by days since 2026-01-01 (local). | `SECURITY DEFINER`, `search_path = public`; execute revoked from `anon`, `authenticated`, `public` |
| A4 | New functions `send_good_morning_fun_fact(timestamptz)`, `send_morning_explore(timestamptz)`, `send_evening_explore(timestamptz)` | Wrappers with the message lists (60 / 30 / 40) and hours (7 / 8 / 17) | Same as A3 |

**Not changed:**
- `notify_user()`, `device_tokens`, `claim_device_token()`, the `send-push` Edge Function
- every **social/transactional** trigger: `notify_on_follow_insert`, `notify_on_follow_accepted`, `notify_on_shared_list_item_insert`, `notify_on_friend_visited_your_to_go_place`
- `purge-expired-place-cache`
- all existing user data: nothing is deleted or rewritten

## B. Scheduler (pg_cron) changes (same migration; needs approval)

**Disabled** (unscheduled; their functions stay in place for rollback):

| # | Job | Schedule now | Function |
|---|---|---|---|
| B1 | `good-morning-treat` | `*/15 * * * *` (8 AM local treat) | `send_good_morning_treat()` |
| B2 | `daily-prompt` | `0 23 * * *` (11 PM UTC food prompt) | `send_daily_prompt()` |
| B3 | `weekly-suggestions` | `0 15 * * 1` | `send_weekly_suggestions()` |
| B4 | `weekly-digest` | `0 16 * * 1` | `send_weekly_digest()` |
| B5 | `inactivity-reminders` | `0 17 * * *` | `send_inactivity_reminders()` |

**Added:**

| # | Job | Schedule | Calls |
|---|---|---|---|
| B6 | `good-morning-fun-fact` | `*/15 * * * *` | `send_good_morning_fun_fact()` |
| B7 | `morning-explore` | `*/15 * * * *` | `send_morning_explore()` |
| B8 | `evening-explore` | `*/15 * * * *` | `send_evening_explore()` |

The jobs run every 15 minutes so every timezone (including +5:30, +5:45 and +12:45) is covered inside its 7, 8 and 17 o'clock hour. The A1 claim makes the extra runs no-ops. **Kept:** `purge-expired-place-cache` and any job not listed here. Result: at most three scheduled engagement pushes per user per day, and only the ones they opted in to.

## C. Required before anyone actually receives a push

| # | Item | Notes | Area |
|---|---|---|---|
| C1 | Confirm delivery credentials, without exposing them | See section E | Edge Function secrets |
| C2 | Ship the app build with first-launch permission and Profile › Notifications | App release | App Store |
| C3 | Update the App Store review notes, privacy labels and Privacy page | Proposed text in section F | App Store / legal |
| C4 | Don't use the manual admin broadcast (`ADMIN_PUSH_SECRET` path in `send-push`) for engagement content | It sends to every device and **ignores in-app consent**. Keep it for operational messages only, or restrict it in a later change. | Policy |

## D. Read-only checks to run in Lovable first

Paste this sentence above each query, and decline any "Apply" or migration offer:

> Run this read-only SQL query against the Cloud database exactly as written and show me the full result table. It only reads. Do not create a migration, do not change anything, and do not "fix" anything it shows.

```sql
-- READ ONLY: every scheduled job. Expect good-morning-treat, daily-prompt,
-- weekly-suggestions, weekly-digest, inactivity-reminders, purge-expired-place-cache.
-- Anything else: tell Claude before applying.
SELECT jobname, schedule, active, command FROM cron.job ORDER BY jobname;
```
```sql
-- READ ONLY: extensions the migration relies on (expect both rows)
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net');
```
```sql
-- READ ONLY: names the migration creates must not exist yet (expect four nulls / false)
SELECT to_regclass('public.daily_push_sent') AS daily_push_sent,
       to_regclass('public.notification_consents') AS notification_consents,
       to_regprocedure('public.send_local_time_push(text,int,text[],text[],timestamptz)') AS sender,
       EXISTS (SELECT 1 FROM cron.job WHERE jobname IN ('good-morning-fun-fact','morning-explore','evening-explore')) AS new_jobs_exist;
```
```sql
-- READ ONLY: the functions the migration unschedules exist (expect 5 rows)
SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('send_good_morning_treat','send_daily_prompt','send_weekly_suggestions','send_weekly_digest','send_inactivity_reminders');
```
```sql
-- READ ONLY: who is reachable today (counts only, no personal data)
SELECT count(DISTINCT d.user_id) AS users_with_device,
       count(DISTINCT d.user_id) FILTER (WHERE p.timezone IS NULL) AS without_timezone
FROM public.device_tokens d LEFT JOIN public.profiles p ON p.user_id = d.user_id;
```

After applying (also read-only): the same `cron.job` query should show exactly the three new jobs plus `purge-expired-place-cache` and any unrelated job, and `SELECT count(*) FROM public.notification_consents;` should be 0 until people opt in.

## E. Validating APNs credentials and permission without exposing secrets

Never paste secret values into chat, documents or SQL. Every check below shows only **names, yes/no answers or status codes**.

1. **Names only.** In Lovable's secrets screen for the `send-push` function, confirm these names exist, without opening the values: `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` (should be `com.afiyeat.app`), `APNS_ENV` (should be `production` for TestFlight/App Store builds), `INTERNAL_PUSH_SECRET`.
2. **Database side, yes/no only** (read-only):
   ```sql
   SELECT EXISTS (SELECT 1 FROM private.secrets WHERE name = 'internal_push_secret') AS internal_push_secret_set;
   ```
3. **End-to-end test to your own phone only, with approval.** Install a TestFlight build of the real app (not the trial; the trial has no push entitlement). Allow notifications and sign in. Then, in Lovable, send one push to your own account only. This sends a notification; it changes no schema or data:
   ```sql
   SELECT public.notify_user('<your user id>'::uuid, 'Test', 'Afiyeat test push', '{"type":"test"}'::jsonb);
   ```
   Expect it on your phone within seconds. If it doesn't arrive, Lovable's `send-push` logs show only the APNs status code and reason (for example `BadDeviceToken` means the `APNS_ENV` doesn't match the build), never the key.
4. **Daily-push path, with approval.** After the migration, opt in on your own account. The next 7/8/17 o'clock local hour should bring exactly one push per opted-in kind. `daily_push_sent` then has one row per kind for you.

Note: `send-push` logs the full device token when APNs rejects one. Tokens aren't secrets, but consider trimming that log line later.

## F. App Store and privacy text to change at release (proposed)

**`docs/APP_REVIEW_NOTES.md`**: replace "The app does not ask for notification permission in this version." with:
> On first launch the app shows Apple's standard notification permission dialog. Notifications are optional and the app is fully usable without them. Daily suggestion notifications (a 7 AM fun fact and city-exploration ideas at 8 AM and 5 PM) are off by default and are only sent after the user turns them on in Profile › Notifications, next to clear consent wording. They can be turned off there at any time.

**`docs/APP_PRIVACY_LABELS.md`** (App Store Connect):
- Declare **Identifiers › Device ID**: push token, used for **App Functionality**, linked to the user, **not** used for tracking.
- Remove it from the "not collected" list. Update the "Data Linked to You" summary to include Identifiers (already listed, now including Device ID).
- The timezone is already covered as part of the account; no new type is needed. Re-check the labels if any analytics are added.

**Privacy page (`src/pages/Privacy.tsx`)**, in the same release:
- "How we use it": change "To send notifications you have allowed." to "To send notifications you have allowed: activity from people you follow and lists shared with you, and, only if you turn them on in Profile › Notifications, up to three daily suggestions."
- "Your choices": add "Turn daily suggestion notifications on or off at any time in Profile › Notifications."

## G. Rollback, and its limitations

```sql
-- 1. Stop the new pushes (safe, immediate, no data loss):
SELECT cron.unschedule(jobname) FROM cron.job
 WHERE jobname IN ('good-morning-fun-fact', 'morning-explore', 'evening-explore');
```
Limitations:
- **Bringing back B1–B5 brings back pushes without in-app consent.** Those older functions send to every user with a device and ignore `notification_consents`. That is the 4.5.4 problem this change fixes, so only re-schedule them with PM sign-off:
  ```sql
  SELECT cron.schedule('good-morning-treat',   '*/15 * * * *', $$ SELECT public.send_good_morning_treat(); $$);
  SELECT cron.schedule('daily-prompt',         '0 23 * * *',   $$ SELECT public.send_daily_prompt(); $$);
  SELECT cron.schedule('weekly-suggestions',   '0 15 * * 1',   $$ SELECT public.send_weekly_suggestions(); $$);
  SELECT cron.schedule('weekly-digest',        '0 16 * * 1',   $$ SELECT public.send_weekly_digest(); $$);
  SELECT cron.schedule('inactivity-reminders', '0 17 * * *',   $$ SELECT public.send_inactivity_reminders(); $$);
  ```
- The new tables and functions can stay; nothing else uses them. Dropping `notification_consents` **permanently deletes users' recorded consents**; the app then hides the Notifications card.
- Withdrawing consent deletes the row, so there is no history of past consents. If an audit trail is needed, that's a separate small change.
- Pushes already handed to APNs can't be recalled.

## H. Order

1. Section D read-only checks → share the results.
2. E1–E2 (names and yes/no only).
3. Approval → apply the migration (A + B) through Lovable as one migration. The current App Store app doesn't read the new tables, so this is safe with the app as it is. Until people opt in with the new app, nobody receives the three daily pushes, and the five older engagement pushes stop.
4. Release the app (C2) together with the C3 text changes.
5. E3–E4 on your own phone.

## I. What was verified (locally, never on a hosted database)

`supabase/tests/daily-notifications/run.sh` uses a throwaway Postgres 16 with stand-ins for `cron` and `notify_user` and the real `claim_device_token`. All checks pass:
- Migration applies cleanly and re-applies harmlessly.
- Cron ends with only the 3 new jobs plus the place-cache cleanup.
- 13 timezones (including +5:30, +5:45, +12:45, −3:30, +14, −11), every 15-minute tick over **74 simulated days** across the 2026 US, EU and Australian clock changes and 31 Dec 2026 → 1 Jan 2027:
  - every push at exactly 7:00, 8:00 or 17:00 local
  - no duplicates; nothing missed for consenting users
  - **no consent → nothing** (existing accounts); consent per push respected
  - no timezone, invalid timezone or no device → nothing
  - two devices → one push per slot
  - messages follow the rotation; no fact repeats across the year end
  - 8 AM / 5 PM never the same activity
- Travel follows the new timezone, once per local date.
- A failed call is retried on the next run without blocking others.
- Account switching on one phone follows the signed-in account's consent only.
- Withdrawing consent stops the push at the next run.
- RLS/grants: users see, give and withdraw only their own consent; no backdating; no edits; visitors have no access; only the scheduler can send.
- Overlapping cron runs don't double-send.
