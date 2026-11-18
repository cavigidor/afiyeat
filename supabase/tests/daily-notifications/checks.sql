-- Checks for 20261118120000_good_morning_fun_facts_and_city_explore.sql.
-- Run by run.sh after harness.sql and the migration (applied twice).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- ---------------------------------------------------------------------
-- Test users
-- ---------------------------------------------------------------------
create temp table zones (n int, tz text);
insert into zones values
  (1, 'America/Chicago'), (2, 'Europe/Istanbul'), (3, 'Asia/Kolkata'),        -- +5:30
  (4, 'Asia/Kathmandu'),                                                       -- +5:45
  (5, 'Australia/Lord_Howe'),                                                  -- 30-minute DST
  (6, 'Pacific/Chatham'),                                                      -- +12:45/+13:45
  (7, 'America/St_Johns'),                                                     -- -3:30
  (8, 'Pacific/Kiritimati'), (9, 'Pacific/Pago_Pago'), (10, 'UTC'),
  (11, 'Europe/London'), (12, 'America/Los_Angeles'), (13, 'Australia/Sydney');

create function pg_temp.uid(n int) returns uuid language sql immutable as
  $$ select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;

-- Eligible users 1..13, one per zone, one device each.
insert into auth.users select pg_temp.uid(n) from zones;
insert into public.profiles select pg_temp.uid(n), tz from zones;
insert into public.device_tokens (user_id, token) select pg_temp.uid(n), 'tok-' || n from zones;

-- 20: Chicago, two devices.          21: Chicago, opted out of morning_explore.
-- 22: no saved timezone.             23: invalid timezone.
-- 24: Chicago, timezone but no device (never allowed notifications / signed out).
insert into auth.users select pg_temp.uid(n) from generate_series(20, 24) n;
insert into public.profiles values
  (pg_temp.uid(20), 'America/Chicago'), (pg_temp.uid(21), 'America/Chicago'),
  (pg_temp.uid(22), null), (pg_temp.uid(23), 'Mars/Olympus_Mons'),
  (pg_temp.uid(24), 'America/Chicago');
insert into public.device_tokens (user_id, token) values
  (pg_temp.uid(20), 'tok-20a'), (pg_temp.uid(20), 'tok-20b'),
  (pg_temp.uid(21), 'tok-21'), (pg_temp.uid(22), 'tok-22'), (pg_temp.uid(23), 'tok-23');
insert into public.notification_opt_outs (user_id, push_kind)
  values (pg_temp.uid(21), 'morning_explore');

create temp table kinds (kind text, hour int);
insert into kinds values ('good_morning_fun_fact', 7), ('morning_explore', 8), ('evening_explore', 17);

-- ---------------------------------------------------------------------
-- 1. Scheduler state
-- ---------------------------------------------------------------------
do $$
declare jobs text;
begin
  select string_agg(jobname || '=' || schedule, ', ' order by jobname) into jobs from cron.job;
  if jobs is distinct from
     'evening-explore=*/15 * * * *, good-morning-fun-fact=*/15 * * * *, morning-explore=*/15 * * * *, weekly-suggestions=0 15 * * 1'
  then
    raise exception 'unexpected cron jobs: %', jobs;
  end if;
end $$;
\echo 'ok  1 cron: three new */15 jobs; good-morning-treat and daily-prompt removed; unrelated jobs untouched'

-- ---------------------------------------------------------------------
-- 2. Simulate every 15-minute cron tick across four windows that include
--    the US, EU and Australian daylight-saving changes of 2026.
-- ---------------------------------------------------------------------
create temp table windows (w_start timestamptz, w_end timestamptz);
insert into windows values
  ('2026-03-06 00:00Z', '2026-03-11 00:00Z'),   -- US spring forward (Mar 8)
  ('2026-03-27 00:00Z', '2026-04-07 00:00Z'),   -- EU spring forward (Mar 29), AU fall back (Apr 5)
  ('2026-09-30 00:00Z', '2026-10-06 00:00Z'),   -- AU spring forward (Oct 4)
  ('2026-10-23 00:00Z', '2026-11-03 00:00Z');   -- EU fall back (Oct 25), US fall back (Nov 1)

do $$
declare t timestamptz;
begin
  for t in
    select gs from windows, generate_series(w_start, w_end - interval '15 minutes', interval '15 minutes') gs
    order by gs
  loop
    perform set_config('test.now', t::text, false);
    perform public.send_good_morning_fun_fact(t);
    perform public.send_morning_explore(t);
    perform public.send_evening_explore(t);
  end loop;
end $$;

create temp view sends as
select l.user_id, l.data->>'type' as kind, l.title, l.body, l.at,
       p.timezone as tz, (l.at at time zone p.timezone) as local_at
from public.sent_log l join public.profiles p using (user_id);

-- 2a. Every send is on the hour, at the right local hour.
do $$
declare bad record;
begin
  select s.* into bad from sends s join kinds k using (kind)
  where extract(hour from s.local_at) <> k.hour or extract(minute from s.local_at) <> 0
  limit 1;
  if found then raise exception 'send at wrong local time: %', row_to_json(bad); end if;
end $$;
\echo 'ok  2a every push went out at exactly 7:00, 8:00 or 17:00 local, across DST changes'

-- 2b. Never two of the same push on the same local date.
do $$
declare bad record;
begin
  select user_id, kind, local_at::date as d, count(*) as n into bad
  from sends group by 1, 2, 3 having count(*) > 1 limit 1;
  if found then raise exception 'duplicate: %', row_to_json(bad); end if;
end $$;
\echo 'ok  2b no duplicates: at most one of each push per user per local date'

-- 2c. Nothing missing: each eligible user got each push on every local
--     date whose target time falls inside a simulated window.
do $$
declare missing record;
begin
  with eligible as (
    select pg_temp.uid(n) as user_id, tz from zones
    union all select pg_temp.uid(20), 'America/Chicago'
    union all select pg_temp.uid(21), 'America/Chicago'
  ),
  expected as (
    select e.user_id, e.tz, k.kind, d::date as local_date
    from eligible e cross join kinds k cross join windows w,
         generate_series((w.w_start at time zone e.tz)::date - 1, (w.w_end at time zone e.tz)::date + 1, interval '1 day') d
    where ((d::date + make_interval(hours => k.hour)) at time zone e.tz) >= w.w_start
      and ((d::date + make_interval(hours => k.hour)) at time zone e.tz) <  w.w_end
      and not (e.user_id = pg_temp.uid(21) and k.kind = 'morning_explore')
  )
  select x.* into missing from expected x
  where not exists (
    select 1 from sends s
    where s.user_id = x.user_id and s.kind = x.kind and s.local_at::date = x.local_date
  )
  limit 1;
  if found then raise exception 'missing send: %', row_to_json(missing); end if;
end $$;
\echo 'ok  2c nothing missed: every eligible user got all three pushes every local day'

-- 2d. Two devices -> still one push per user (send-push fans it out per device).
do $$
declare a int; b int;
begin
  select count(*) into a from sends where user_id = pg_temp.uid(20);
  select count(*) into b from sends where user_id = pg_temp.uid(1);
  if a <> b then raise exception 'two-device user got % pushes, single-device Chicago user got %', a, b; end if;
end $$;
\echo 'ok  2d a user with two devices gets one push per slot, same as a one-device user'

-- 2e. Opt-out, missing timezone, invalid timezone, no device.
do $$
declare n int;
begin
  select count(*) into n from sends where user_id = pg_temp.uid(21) and kind = 'morning_explore';
  if n <> 0 then raise exception 'opted-out user got % morning_explore pushes', n; end if;
  select count(*) into n from sends where user_id = pg_temp.uid(21) and kind <> 'morning_explore';
  if n = 0 then raise exception 'opted-out user lost the pushes they did not opt out of'; end if;
  select count(*) into n from public.sent_log where user_id in (pg_temp.uid(22), pg_temp.uid(23), pg_temp.uid(24));
  if n <> 0 then raise exception 'no-timezone / invalid-timezone / no-device users got % pushes', n; end if;
end $$;
\echo 'ok  2e opt-out respected per push; no timezone, invalid timezone and no device -> nothing sent'

-- 2f. Copy: the right message set per push, rotating by local day.
do $$
declare n int;
begin
  select count(*) into n from sends where kind = 'good_morning_fun_fact' and title not like 'Good morning! %';
  if n <> 0 then raise exception 'fun-fact push without Good morning title'; end if;
  -- Same local day -> same fact for everyone; a different day in the
  -- 60-day cycle -> a different fact.
  select count(*) into n from (
    select extract(doy from local_at::date)::int % 60 as slot
    from sends where kind = 'good_morning_fun_fact'
    group by 1 having count(distinct body) <> 1
  ) x;
  if n <> 0 then raise exception 'fun fact differs within one rotation slot'; end if;
  select abs(count(distinct body) - count(distinct extract(doy from local_at::date)::int % 60)) into n
  from sends where kind = 'good_morning_fun_fact';
  if n <> 0 then raise exception 'fun facts not one-per-rotation-slot'; end if;
  select count(*) into n from sends a join sends b
    on a.user_id = b.user_id and a.local_at::date = b.local_at::date
   and a.kind = 'morning_explore' and b.kind = 'evening_explore' and a.body = b.body;
  if n <> 0 then raise exception 'same idea sent at 8am and 5pm on one day'; end if;
end $$;
\echo 'ok  2f messages rotate daily; 8am and 5pm never repeat the same idea'

-- ---------------------------------------------------------------------
-- 3. Travel: the saved timezone follows the user.
-- ---------------------------------------------------------------------
truncate public.sent_log;
update public.profiles set timezone = 'Europe/Istanbul' where user_id = pg_temp.uid(1);
-- Chicago user already had their Nov 2 (Chicago) pushes in the simulation;
-- flying east, Istanbul's Nov 3 07:00 (04:00Z) should send.
select set_config('test.now', '2026-11-03 04:00Z', false);
select public.send_good_morning_fun_fact('2026-11-03 04:00Z');
-- Flying back west the same Istanbul day to Chicago: Nov 3 07:00 Chicago is
-- the same local date -> no second fun fact.
update public.profiles set timezone = 'America/Chicago' where user_id = pg_temp.uid(1);
select set_config('test.now', '2026-11-03 13:00Z', false);
select public.send_good_morning_fun_fact('2026-11-03 13:00Z');
do $$
declare n int;
begin
  select count(*) into n from public.sent_log where user_id = pg_temp.uid(1);
  if n <> 1 then raise exception 'traveller got % fun facts for one local date, expected 1', n; end if;
end $$;
\echo 'ok  3  travel: pushes follow the newly saved timezone, still once per local date'

-- ---------------------------------------------------------------------
-- 4. A failed delivery for one user doesn't block others and is retried.
-- ---------------------------------------------------------------------
truncate public.sent_log;
select set_config('test.fail_user', pg_temp.uid(2)::text, false);
select set_config('test.now', '2026-11-05 04:00Z', false);          -- 07:00 Istanbul
select public.send_good_morning_fun_fact('2026-11-05 04:00Z');
select set_config('test.fail_user', '', false);
select set_config('test.now', '2026-11-05 04:15Z', false);          -- next tick
select public.send_good_morning_fun_fact('2026-11-05 04:15Z');
select set_config('test.now', '2026-11-05 04:30Z', false);
select public.send_good_morning_fun_fact('2026-11-05 04:30Z');
do $$
declare n int;
begin
  select count(*) into n from public.sent_log where user_id = pg_temp.uid(2);
  if n <> 1 then raise exception 'failed user: % sends after retry, expected 1', n; end if;
end $$;
\echo 'ok  4  one failed delivery: retried on the next 15-minute run, sent once'

-- ---------------------------------------------------------------------
-- 5. Permissions
-- ---------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.uid(1)::text, false);
insert into public.notification_opt_outs (user_id, push_kind) values (pg_temp.uid(1), 'evening_explore');
do $$
declare n int;
begin
  select count(*) into n from public.notification_opt_outs;
  if n <> 1 then raise exception 'user sees % opt-out rows, expected only their own 1', n; end if;
  begin
    insert into public.notification_opt_outs (user_id, push_kind) values ('00000000-0000-0000-0000-000000000002', 'evening_explore');
    raise exception 'inserted an opt-out for another user';
  exception when insufficient_privilege then null;
  end;
  delete from public.notification_opt_outs where user_id = '00000000-0000-0000-0000-000000000021';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'deleted another user''s opt-out'; end if;
  begin
    insert into public.notification_opt_outs (user_id, push_kind) values ('00000000-0000-0000-0000-000000000001', 'everything');
    raise exception 'accepted an unknown push kind';
  exception when check_violation then null;
  end;
  begin
    perform public.send_morning_explore();
    raise exception 'signed-in user could trigger a send';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.daily_push_sent;
    raise exception 'signed-in user could read daily_push_sent';
  exception when insufficient_privilege then null;
  end;
end $$;
delete from public.notification_opt_outs where push_kind = 'evening_explore';
reset role;
\echo 'ok  5  opt-outs: users see/add/remove only their own; cannot trigger sends or read send history'
