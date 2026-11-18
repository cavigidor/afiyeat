-- Minimal stand-ins for the parts of the Supabase/Lovable database that the
-- daily-notification migration touches. For local testing only: never run
-- against a real project.
do $$ begin
  create role anon; create role authenticated; create role service_role;
exception when duplicate_object then null; end $$;

create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant usage on schema public to authenticated;

create table public.profiles (user_id uuid primary key references auth.users(id), timezone text);
create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique
);

-- pg_cron stand-in
create schema cron;
create table cron.job (jobname text primary key, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as
  $$ insert into cron.job values (n, s, c)
     on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command;
     select 1::bigint $$;
create function cron.unschedule(n text) returns boolean language sql as
  $$ delete from cron.job where jobname = n; select true $$;

-- notify_user stand-in: records what would have been pushed, and when.
create table public.sent_log (
  user_id uuid, title text, body text, data jsonb,
  at timestamptz default nullif(current_setting('test.now', true), '')::timestamptz
);
create function public.notify_user(u uuid, t text, b text, d jsonb) returns void language plpgsql as $$
begin
  if current_setting('test.fail_user', true) = u::text then
    raise exception 'simulated delivery failure';
  end if;
  insert into public.sent_log (user_id, title, body, data) values (u, t, b, d);
end $$;

-- What the old migrations leave behind.
create function public.send_good_morning_treat() returns void language sql as $$ select $$;
create function public.send_daily_prompt() returns void language sql as $$ select $$;
select cron.schedule('good-morning-treat', '*/15 * * * *', 'select public.send_good_morning_treat();');
select cron.schedule('daily-prompt', '0 23 * * *', 'select public.send_daily_prompt();');
select cron.schedule('weekly-suggestions', '0 15 * * 1', 'select 1;');
