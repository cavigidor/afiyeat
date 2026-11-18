-- Daily engagement notifications: at most three a day, at a fixed local time
-- in the user's own saved timezone (profiles.timezone, which the app saves
-- at sign-in and whenever it returns to the foreground with a new zone):
--
--   7am  good_morning_fun_fact  "Good morning!" + a fact about animals, the
--                               world, nature or space ({{FACT_COUNT}}, one per day).
--   8am  morning_explore        Explore your city ({{MORNING_COUNT}} ideas).
--   5pm  evening_explore        Evening city exploration ({{EVENING_COUNT}} ideas). Cafés and
--                               restaurants only appear as places to explore.
--
-- CONSENT (App Review Guideline 4.5.4): these are engagement/promotional
-- pushes, so they go ONLY to users who explicitly opted in to that push in
-- Profile > Notifications, where the consent wording is shown. One row in
-- notification_consents per push the user agreed to. No row = no push.
-- Existing accounts start with no rows, so nobody receives any of these
-- until they opt in themselves; allowing notifications in the iOS dialog is
-- not consent to these.
--
-- Eligible for push p on a given day = has a registered device token
--   AND has a saved, valid timezone AND has a consent row for p.
-- The app removes a device's token when iOS notification permission is off,
-- and on sign-out; a token belongs to one account at a time
-- (claim_device_token moves it to whoever signs in on that phone).
--
-- Duplicates: each send is claimed in daily_push_sent (one row per user per
-- push, holding the local date of the last send) with an atomic upsert
-- BEFORE notify_user() is called. Overlapping or repeated cron runs,
-- several devices, or travel across the date line can't produce a second
-- push for the same local date. notify_user() fans out to every device the
-- user is signed in on; each device gets it once.
--
-- Rotation: by days since 2026-01-01 in the user's local date, so the 60
-- facts never repeat within 60 days, including across 31 Dec / 1 Jan, and
-- the 8am and 5pm lists are ordered so the same kind of activity is never
-- suggested twice on one day.
--
-- Scheduler: retires every older scheduled ENGAGEMENT push, so the three
-- above are the only ones:
--   - good-morning-treat    (8am treat)                   send_good_morning_treat()
--   - daily-prompt          (11pm UTC food prompt)        send_daily_prompt()
--   - weekly-suggestions    (Mon 15:00 UTC)               send_weekly_suggestions()
--   - weekly-digest         (Mon 16:00 UTC)               send_weekly_digest()
--   - inactivity-reminders  (daily 17:00 UTC)             send_inactivity_reminders()
-- Their functions are left in place (unscheduled) for rollback.
-- NOT touched: social/transactional pushes, which are triggers, not cron
-- (notify_on_follow_insert, notify_on_follow_accepted,
-- notify_on_shared_list_item_insert, notify_on_friend_visited_your_to_go_place),
-- notify_user(), device_tokens, the send-push Edge Function, and the
-- purge-expired-place-cache maintenance job.
--
-- Rollback: see the end of this file.

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table if not exists public.daily_push_sent (
  user_id uuid not null references auth.users(id) on delete cascade,
  push_kind text not null,
  last_sent_date date not null,
  primary key (user_id, push_kind)
);

grant all on public.daily_push_sent to service_role;
alter table public.daily_push_sent enable row level security;
-- No policies: only the SECURITY DEFINER senders below touch it.

-- Explicit opt-in, one row per push the user agreed to. consent_version
-- records which wording they saw (see src/lib/notificationPreferences.ts).
create table if not exists public.notification_consents (
  user_id uuid not null references auth.users(id) on delete cascade,
  push_kind text not null
    check (push_kind in ('good_morning_fun_fact', 'morning_explore', 'evening_explore')),
  consent_version text not null check (char_length(consent_version) between 1 and 40),
  consented_at timestamptz not null default now(),
  primary key (user_id, push_kind)
);

-- Users may only supply which push and which wording; consented_at is
-- always the server's clock, so a consent time can't be backdated.
grant select, delete on public.notification_consents to authenticated;
grant insert (user_id, push_kind, consent_version) on public.notification_consents to authenticated;
grant all on public.notification_consents to service_role;
alter table public.notification_consents enable row level security;

drop policy if exists "Users can view own notification consents" on public.notification_consents;
create policy "Users can view own notification consents"
  on public.notification_consents for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can give own notification consent" on public.notification_consents;
create policy "Users can give own notification consent"
  on public.notification_consents for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can withdraw own notification consent" on public.notification_consents;
create policy "Users can withdraw own notification consent"
  on public.notification_consents for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Shared sender
-- ---------------------------------------------------------------------

-- Sends push p_kind to every eligible user (see header) whose local time at
-- p_now is within hour p_hour, at most once per user per local date.
-- Returns the number of users sent to. p_now exists so the behaviour can
-- be tested at any moment; the cron jobs always use now().
create or replace function public.send_local_time_push(
  p_kind text,
  p_hour int,
  p_titles text[],
  p_bodies text[],
  p_now timestamptz default now()
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  local_now timestamp;
  local_date date;
  claimed boolean;
  n int;
  msg_idx int;
  sent int := 0;
begin
  n := coalesce(array_length(p_titles, 1), 0);
  if n = 0 or n <> coalesce(array_length(p_bodies, 1), 0) then
    raise exception 'send_local_time_push(%): titles and bodies must be non-empty and the same length', p_kind;
  end if;

  for r in
    select distinct dt.user_id, p.timezone as tz
    from public.device_tokens dt
    join public.profiles p on p.user_id = dt.user_id
    join public.notification_consents c on c.user_id = dt.user_id and c.push_kind = p_kind
    where p.timezone is not null
  loop
    -- A timezone that isn't a real IANA name is skipped for that user
    -- rather than aborting the whole run.
    begin
      local_now := p_now at time zone r.tz;
    exception when others then
      continue;
    end;

    if extract(hour from local_now)::int <> p_hour then
      continue;
    end if;
    local_date := local_now::date;

    begin
      -- Claim today's send first. The upsert only succeeds if this user
      -- hasn't had this push for this local date (or a later one, e.g.
      -- after flying west across the date line); a concurrent run blocks on
      -- the row and then finds it already claimed.
      claimed := null;
      insert into public.daily_push_sent as s (user_id, push_kind, last_sent_date)
      values (r.user_id, p_kind, local_date)
      on conflict (user_id, push_kind) do update
        set last_sent_date = excluded.last_sent_date
        where s.last_sent_date < excluded.last_sent_date
      returning true into claimed;

      if claimed is null then
        continue;
      end if;

      -- Days since 2026-01-01 (local), so the cycle runs straight through
      -- 31 Dec / 1 Jan instead of restarting each year.
      msg_idx := (((local_date - date '2026-01-01') % n) + n) % n + 1;

      perform public.notify_user(
        r.user_id,
        p_titles[msg_idx],
        p_bodies[msg_idx],
        jsonb_build_object('type', p_kind)
      );
      sent := sent + 1;
    exception when others then
      -- Undo this user's claim so the next run (15 minutes later, same
      -- hour) retries them, and carry on with everyone else.
      raise warning 'send_local_time_push(%): user % failed: %', p_kind, r.user_id, sqlerrm;
    end;
  end loop;

  return sent;
end;
$$;

revoke execute on function public.send_local_time_push(text, int, text[], text[], timestamptz)
  from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- 7am: Good morning + fun fact
-- ---------------------------------------------------------------------

create or replace function public.send_good_morning_fun_fact(p_now timestamptz default now())
returns int
language sql
security definer
set search_path = public
as $$
  select public.send_local_time_push(
    'good_morning_fun_fact',
    7,
    {{FACT_TITLES}},
    {{FACT_BODIES}},
    p_now
  );
$$;

revoke execute on function public.send_good_morning_fun_fact(timestamptz) from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- 8am: Explore your city
-- ---------------------------------------------------------------------

create or replace function public.send_morning_explore(p_now timestamptz default now())
returns int
language sql
security definer
set search_path = public
as $$
  select public.send_local_time_push(
    'morning_explore',
    8,
    {{MORNING_TITLES}},
    {{MORNING_BODIES}},
    p_now
  );
$$;

revoke execute on function public.send_morning_explore(timestamptz) from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- 5pm: Evening city exploration
-- ---------------------------------------------------------------------

create or replace function public.send_evening_explore(p_now timestamptz default now())
returns int
language sql
security definer
set search_path = public
as $$
  select public.send_local_time_push(
    'evening_explore',
    17,
    {{EVENING_TITLES}},
    {{EVENING_BODIES}},
    p_now
  );
$$;

revoke execute on function public.send_evening_explore(timestamptz) from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- Scheduler
-- ---------------------------------------------------------------------
-- Every 15 minutes, so every timezone (including +5:30, +5:45 and +12:45
-- offsets) gets four chances inside its 7am, 8am and 5pm hour; the claim
-- above makes the extra runs no-ops.

select cron.unschedule(jobname)
from cron.job
where jobname in (
  'good-morning-treat', 'daily-prompt', 'weekly-suggestions', 'weekly-digest', 'inactivity-reminders',
  'good-morning-fun-fact', 'morning-explore', 'evening-explore'
);

select cron.schedule('good-morning-fun-fact', '*/15 * * * *', $$ select public.send_good_morning_fun_fact(); $$);
select cron.schedule('morning-explore',       '*/15 * * * *', $$ select public.send_morning_explore(); $$);
select cron.schedule('evening-explore',       '*/15 * * * *', $$ select public.send_evening_explore(); $$);

-- ---------------------------------------------------------------------
-- Rollback (run manually only if needed; not part of this migration)
-- ---------------------------------------------------------------------
-- 1. Stop the new pushes (safe, immediate):
--   select cron.unschedule(jobname) from cron.job
--    where jobname in ('good-morning-fun-fact', 'morning-explore', 'evening-explore');
--
-- 2. Only if the old pushes should come back. LIMITATION: the old functions
--    send to EVERY user with a device and ignore notification_consents, so
--    this brings back engagement pushes without in-app consent.
--   select cron.schedule('good-morning-treat',   '*/15 * * * *', $$ select public.send_good_morning_treat(); $$);
--   select cron.schedule('daily-prompt',         '0 23 * * *',   $$ select public.send_daily_prompt(); $$);
--   select cron.schedule('weekly-suggestions',   '0 15 * * 1',   $$ select public.send_weekly_suggestions(); $$);
--   select cron.schedule('weekly-digest',        '0 16 * * 1',   $$ select public.send_weekly_digest(); $$);
--   select cron.schedule('inactivity-reminders', '0 17 * * *',   $$ select public.send_inactivity_reminders(); $$);
--
-- 3. The new tables and functions can stay (nothing else uses them). If
--    they must go: drop the three wrappers, send_local_time_push,
--    daily_push_sent and notification_consents, which deletes users'
--    recorded consents; the app's Notifications card then hides itself.
