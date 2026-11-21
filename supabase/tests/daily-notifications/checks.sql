-- Checks for 20261118120000_good_morning_fun_facts_and_city_explore.sql.
-- Run by run.sh after harness.sql and the migration (applied twice), with
-- -v msgs=<messages.json> so message order can be checked.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create temp table msgs as select :'msgs'::jsonb as j;

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

create temp table kinds (kind text, hour int);
insert into kinds values ('good_morning_fun_fact', 7), ('morning_explore', 8), ('evening_explore', 17);

-- 1..13: one per zone, one device, opted in to all three.
insert into auth.users select pg_temp.uid(n) from zones;
insert into public.profiles select pg_temp.uid(n), tz from zones;
insert into public.device_tokens (user_id, token) select pg_temp.uid(n), 'tok-' || n from zones;
insert into public.notification_consents (user_id, push_kind, consent_version)
  select pg_temp.uid(n), k.kind, 'test-v1' from zones, kinds k;

-- 20: Chicago, two devices, opted in to all three.
-- 21: Chicago, opted in to the 7am and 5pm pushes only (not 8am).
-- 22: no saved timezone, opted in.          23: invalid timezone, opted in.
-- 24: Chicago, opted in, no device (permission off / signed out: token removed).
-- 25: Chicago, device + timezone, NO consent (an existing account before this change).
insert into auth.users select pg_temp.uid(n) from generate_series(20, 25) n;
insert into public.profiles values
  (pg_temp.uid(20), 'America/Chicago'), (pg_temp.uid(21), 'America/Chicago'),
  (pg_temp.uid(22), null), (pg_temp.uid(23), 'Mars/Olympus_Mons'),
  (pg_temp.uid(24), 'America/Chicago'), (pg_temp.uid(25), 'America/Chicago');
insert into public.device_tokens (user_id, token) values
  (pg_temp.uid(20), 'tok-20a'), (pg_temp.uid(20), 'tok-20b'),
  (pg_temp.uid(21), 'tok-21'), (pg_temp.uid(22), 'tok-22'), (pg_temp.uid(23), 'tok-23'),
  (pg_temp.uid(25), 'tok-25');
insert into public.notification_consents (user_id, push_kind, consent_version)
  select pg_temp.uid(n), k.kind, 'test-v1'
  from generate_series(20, 24) n, kinds k
  where not (n = 21 and k.kind = 'morning_explore');

-- ---------------------------------------------------------------------
-- 1. Scheduler state
-- ---------------------------------------------------------------------
do $$
declare jobs text;
begin
  select string_agg(jobname || '=' || schedule, ', ' order by jobname) into jobs from cron.job;
  if jobs is distinct from
     'evening-explore=*/15 * * * *, good-morning-fun-fact=*/15 * * * *, morning-explore=*/15 * * * *, purge-expired-place-cache=17 4 * * *'
  then
    raise exception 'unexpected cron jobs: %', jobs;
  end if;
end $$;
\echo 'ok  1  cron: only the 3 new */15 jobs + the place-cache cleanup; treat, daily prompt, weekly suggestions, weekly digest, inactivity removed'

-- ---------------------------------------------------------------------
-- 2. Simulate every 15-minute cron tick across five windows: the 2026 US,
--    EU and Australian clock changes, and 31 Dec 2026 -> 1 Jan 2027.
-- ---------------------------------------------------------------------
create temp table windows (w_start timestamptz, w_end timestamptz);
insert into windows values
  ('2026-03-06 00:00Z', '2026-03-11 00:00Z'),   -- US spring forward (Mar 8)
  ('2026-03-27 00:00Z', '2026-04-07 00:00Z'),   -- EU spring forward (Mar 29), AU fall back (Apr 5)
  ('2026-09-30 00:00Z', '2026-10-06 00:00Z'),   -- AU spring forward (Oct 4)
  ('2026-10-23 00:00Z', '2026-11-03 00:00Z'),   -- EU fall back (Oct 25), US fall back (Nov 1)
  ('2026-12-10 00:00Z', '2027-01-20 00:00Z');   -- year end: 41 days

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
       p.timezone as tz, (l.at at time zone p.timezone) as local_at,
       ((l.at at time zone p.timezone)::date - date '2026-01-01') as day_no
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
\echo 'ok  2a every push went out at exactly 7:00, 8:00 or 17:00 local, across DST changes and the year end'

-- 2b. Never two of the same push on the same local date.
do $$
declare bad record;
begin
  select user_id, kind, local_at::date as d, count(*) as n into bad
  from sends group by 1, 2, 3 having count(*) > 1 limit 1;
  if found then raise exception 'duplicate: %', row_to_json(bad); end if;
end $$;
\echo 'ok  2b no duplicates: at most one of each push per user per local date'

-- 2c. Nothing missing for consenting users.
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
\echo 'ok  2c nothing missed: every consenting user got each push they agreed to, every local day'

-- 2d. Consent is required; everyone else gets nothing.
do $$
declare n int;
begin
  select count(*) into n from public.sent_log where user_id = pg_temp.uid(25);
  if n <> 0 then raise exception 'user without consent (existing account) got % pushes', n; end if;
  select count(*) into n from sends where user_id = pg_temp.uid(21) and kind = 'morning_explore';
  if n <> 0 then raise exception 'user who did not opt in to 8am got % of them', n; end if;
  select count(*) into n from sends where user_id = pg_temp.uid(21) and kind <> 'morning_explore';
  if n = 0 then raise exception 'user lost the pushes they did opt in to'; end if;
  select count(*) into n from public.sent_log where user_id in (pg_temp.uid(22), pg_temp.uid(23), pg_temp.uid(24));
  if n <> 0 then raise exception 'no-timezone / invalid-timezone / no-device users got % pushes', n; end if;
end $$;
\echo 'ok  2d consent required per push: no consent (existing accounts) -> nothing; no timezone, bad timezone or no device -> nothing'

-- 2e. Two devices -> one push per user per slot.
do $$
declare a int; b int;
begin
  select count(*) into a from sends where user_id = pg_temp.uid(20);
  select count(*) into b from sends where user_id = pg_temp.uid(1);
  if a <> b then raise exception 'two-device user got % pushes, one-device Chicago user got %', a, b; end if;
end $$;
\echo 'ok  2e a user with two devices gets one push per slot (send-push then delivers it to each device)'

-- 2f. Copy follows the published rotation, which runs straight through the year end.
do $$
declare bad record; n int;
begin
  select s.kind, s.local_at::date as d, s.body, x.body as expected into bad
  from sends s, msgs m,
       lateral (select (m.j -> s.kind -> ((s.day_no % jsonb_array_length(m.j -> s.kind) + jsonb_array_length(m.j -> s.kind)) % jsonb_array_length(m.j -> s.kind))::int) ->> 'body' as body) x
  where s.body is distinct from x.body
  limit 1;
  if found then raise exception 'message out of rotation: %', row_to_json(bad); end if;

  select count(*) into n from sends where kind = 'good_morning_fun_fact' and title <> 'Good morning!';
  if n <> 0 then raise exception 'fun fact without the "Good morning!" title'; end if;

  -- 41 consecutive local days around 31 Dec / 1 Jan: 41 different facts.
  select count(*) - count(distinct body) into n
  from sends where kind = 'good_morning_fun_fact' and user_id = pg_temp.uid(1)
    and local_at >= '2026-12-10' and local_at < '2027-01-20';
  if n <> 0 then raise exception '% fun facts repeated across the year end', n; end if;
end $$;
\echo 'ok  2f messages follow the rotation; 60 facts in order with no repeat across 31 Dec / 1 Jan; title "Good morning!"'

-- 2g. 8am and 5pm never suggest the same kind of activity on one day.
do $$
declare bad record;
begin
  select a.user_id, a.local_at::date as d, a.body as morning, b.body as evening into bad
  from sends a join sends b
    on a.user_id = b.user_id and a.local_at::date = b.local_at::date
   and a.kind = 'morning_explore' and b.kind = 'evening_explore'
  cross join msgs m
  where (select x->>'activity' from jsonb_array_elements(m.j->'morning_explore') x where x->>'body' = a.body)
      = (select x->>'activity' from jsonb_array_elements(m.j->'evening_explore') x where x->>'body' = b.body)
  limit 1;
  if found then raise exception 'same activity at 8am and 5pm: %', row_to_json(bad); end if;
end $$;
\echo 'ok  2g 8am and 5pm never suggest the same kind of activity on the same day'

-- ---------------------------------------------------------------------
-- 3. Travel: the saved timezone follows the user.
-- ---------------------------------------------------------------------
truncate public.sent_log;
update public.profiles set timezone = 'Europe/Istanbul' where user_id = pg_temp.uid(1);
select set_config('test.now', '2027-01-21 04:00Z', false);   -- 07:00 Istanbul, Jan 21
select public.send_good_morning_fun_fact('2027-01-21 04:00Z');
update public.profiles set timezone = 'America/Chicago' where user_id = pg_temp.uid(1);
select set_config('test.now', '2027-01-21 13:00Z', false);   -- 07:00 Chicago, same local date
select public.send_good_morning_fun_fact('2027-01-21 13:00Z');
do $$
declare n int;
begin
  select count(*) into n from public.sent_log where user_id = pg_temp.uid(1);
  if n <> 1 then raise exception 'traveller got % fun facts for one local date, expected 1', n; end if;
end $$;
\echo 'ok  3  travel: pushes follow the newly saved timezone, still once per local date'

-- ---------------------------------------------------------------------
-- 4. A failed call for one user doesn't block others and is retried.
-- ---------------------------------------------------------------------
truncate public.sent_log;
-- User 1 moves to Moscow (UTC+3, like Istanbul) so two users are at 7am together.
update public.profiles set timezone = 'Europe/Moscow' where user_id = pg_temp.uid(1);
select set_config('test.fail_user', pg_temp.uid(2)::text, false);
select set_config('test.now', '2027-01-23 04:00Z', false);          -- 07:00 Istanbul
select public.send_good_morning_fun_fact('2027-01-23 04:00Z');
select set_config('test.fail_user', '', false);
select set_config('test.now', '2027-01-23 04:15Z', false);
select public.send_good_morning_fun_fact('2027-01-23 04:15Z');
select set_config('test.now', '2027-01-23 04:30Z', false);
select public.send_good_morning_fun_fact('2027-01-23 04:30Z');
do $$
declare n int;
begin
  select count(*) into n from public.sent_log where user_id = pg_temp.uid(2);
  if n <> 1 then raise exception 'failed user: % sends after retry, expected 1', n; end if;
  select count(*) into n from public.sent_log where user_id <> pg_temp.uid(2);
  if n = 0 then raise exception 'one failure blocked everyone else'; end if;
end $$;
\echo 'ok  4  one failed call: others still sent; that user retried on the next 15-minute run, sent once'

-- ---------------------------------------------------------------------
-- 5. Account switching on one phone (real claim_device_token).
--    Phone tok-1 belongs to user 1 (consented). User 25 (no consent) signs in on it.
-- ---------------------------------------------------------------------
truncate public.sent_log;
set role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.uid(25)::text, false);
select public.claim_device_token('tok-1', 'ios');
reset role;
select set_config('test.now', '2027-01-25 13:00Z', false);          -- 07:00 Chicago
select public.send_good_morning_fun_fact('2027-01-25 13:00Z');
do $$
declare n int;
begin
  select count(*) into n from public.sent_log where user_id in (pg_temp.uid(1), pg_temp.uid(25));
  if n <> 0 then raise exception 'after switching accounts the phone still got % engagement pushes', n; end if;
end $$;
-- User 25 now opts in on that phone: from the next day they get it.
insert into public.notification_consents (user_id, push_kind, consent_version)
  values (pg_temp.uid(25), 'good_morning_fun_fact', 'test-v1');
select set_config('test.now', '2027-01-26 13:00Z', false);
select public.send_good_morning_fun_fact('2027-01-26 13:00Z');
do $$
declare n int;
begin
  select count(*) into n from public.sent_log where user_id = pg_temp.uid(25);
  if n <> 1 then raise exception 'new account owner after opting in got %, expected 1', n; end if;
  select count(*) into n from public.sent_log where user_id = pg_temp.uid(1);
  if n <> 0 then raise exception 'previous account still reached the phone'; end if;
end $$;
\echo 'ok  5  account switch: the phone follows the signed-in account and that account''s consent only'

-- Withdrawing consent stops the push from the next run.
delete from public.notification_consents where user_id = pg_temp.uid(25);
truncate public.sent_log;
select set_config('test.now', '2027-01-27 13:00Z', false);
select public.send_good_morning_fun_fact('2027-01-27 13:00Z');
do $$
begin
  if exists (select 1 from public.sent_log where user_id = pg_temp.uid(25)) then
    raise exception 'push sent after consent was withdrawn';
  end if;
end $$;
\echo 'ok  6  withdrawing consent stops the push at the next run'

-- ---------------------------------------------------------------------
-- 7. Permissions
-- ---------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.uid(25)::text, false);
insert into public.notification_consents (user_id, push_kind, consent_version)
  values (pg_temp.uid(25), 'evening_explore', 'test-v1');
do $$
declare n int; ts timestamptz;
begin
  select count(*) into n from public.notification_consents;
  if n <> 1 then raise exception 'user sees % consent rows, expected only their own 1', n; end if;
  select consented_at into ts from public.notification_consents;
  if ts < now() - interval '1 minute' then raise exception 'consented_at not set by the server'; end if;
  begin
    insert into public.notification_consents (user_id, push_kind, consent_version)
      values ('00000000-0000-0000-0000-000000000002', 'evening_explore', 'x');
    raise exception 'gave consent on behalf of another user';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.notification_consents (user_id, push_kind, consent_version, consented_at)
      values ('00000000-0000-0000-0000-000000000025', 'morning_explore', 'x', '2020-01-01');
    raise exception 'backdated a consent';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.notification_consents set consent_version = 'edited';
    raise exception 'edited a consent row';
  exception when insufficient_privilege then null;
  end;
  delete from public.notification_consents where user_id = '00000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'withdrew another user''s consent'; end if;
  begin
    insert into public.notification_consents (user_id, push_kind, consent_version)
      values ('00000000-0000-0000-0000-000000000025', 'everything', 'x');
    raise exception 'accepted an unknown push kind';
  exception when check_violation then null;
  end;
  begin
    perform public.send_morning_explore();
    raise exception 'signed-in user could trigger a send';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.send_local_time_push('morning_explore', 8, array['t'], array['b']);
    raise exception 'signed-in user could call the shared sender';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.daily_push_sent;
    raise exception 'signed-in user could read daily_push_sent';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set role anon;
do $$
begin
  begin
    perform 1 from public.notification_consents;
    raise exception 'anonymous visitor could read consents';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.send_good_morning_fun_fact();
    raise exception 'anonymous visitor could trigger a send';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
\echo 'ok  7  RLS/grants: users see, give and withdraw only their own consent; server-set consent time; no edits; nobody but the scheduler can send'
