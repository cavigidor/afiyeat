-- Daily "go get a treat" push: fires at 8am in each user's own local
-- timezone (not one fixed UTC time like the other daily/weekly crons),
-- with a quirky title+body that rotates through a 30-day set so it
-- doesn't repeat for a month. Nudges baked goods, coffee, tea, or matcha.

-- Client (PushNotificationManager.tsx) now keeps this reasonably fresh on
-- every sign-in/cold start via Intl.DateTimeFormat().resolvedOptions().timeZone.
-- Users who haven't opened the app since this shipped will have timezone
-- IS NULL until they do - the cron below falls back to UTC for those, so
-- they still get a push once a day (just not necessarily at their local
-- 8am until their timezone is captured).
alter table public.profiles
  add column if not exists timezone text;

-- Per-user "already sent today" guard. The cron runs every 15 minutes and
-- checks each user's own local hour, so without this a user would get the
-- push up to 4 times during their 8am hour.
create table if not exists public.good_morning_sent (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_sent_date date not null
);

grant all on public.good_morning_sent to service_role;
alter table public.good_morning_sent enable row level security;

create or replace function public.send_good_morning_treat()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  local_date date;
  msg_idx int;
  msg_title text;
  msg_body text;
begin
  for r in
    select distinct dt.user_id, coalesce(p.timezone, 'UTC') as tz
    from public.device_tokens dt
    join public.profiles p on p.user_id = dt.user_id
  loop
    -- Skip anything that isn't a real IANA zone name (a stray client value,
    -- etc.) rather than let AT TIME ZONE error out and abort the whole loop.
    begin
      local_date := (now() at time zone r.tz)::date;
    exception when others then
      continue;
    end;

    if extract(hour from (now() at time zone r.tz))::int <> 8 then
      continue;
    end if;

    if exists (
      select 1 from public.good_morning_sent
      where user_id = r.user_id and last_sent_date = local_date
    ) then
      continue;
    end if;

    msg_idx := extract(doy from local_date)::int % 30;

    select title, body into msg_title, msg_body
    from (values
      (0,  'Rise and shine (and carbs)',        'A croissant is basically a hug you can eat. Go get one.'),
      (1,  'Coffee o''clock',                    'Your coffee order is out there waiting. Don''t keep it waiting.'),
      (2,  'Tea time, but make it morning',      'A warm cup of tea and today already feels more manageable.'),
      (3,  'Matcha made in heaven',              'Skip the 3pm slump before it starts - matcha''s calling.'),
      (4,  'Good morning, treat yourself',       'One donut. Zero regrets. You''ve earned it.'),
      (5,  'Cinnamon roll szn',                  'Somewhere nearby, a cinnamon roll is getting warm just for you.'),
      (6,  'Brew first, adult later',            'Nothing productive happens before coffee. Science, probably.'),
      (7,  'Muffin top of the morning to ya',    'Blueberry, chocolate chip, doesn''t matter - just get one.'),
      (8,  'Chai hard',                          'A spicy chai and a slow morning. Perfect combo.'),
      (9,  'Bagel alert',                        'Toasted, cream cheese, done. Your bagel is calling.'),
      (10, 'Sip happens',                        'Whatever''s in your cup, make sure it''s something good.'),
      (11, 'Scone away with me',                 'A flaky scone solves at least 60% of Mondays.'),
      (12, 'Latte art appreciation hour',        'Someone made your coffee pretty. Go admire it in person.'),
      (13, 'Matcha o''clock, actually',          'Green, earthy, slightly smug - matcha''s ready when you are.'),
      (14, 'Pastry o''clock',                    'A little flour, a little butter, a lot of joy. Go find one.'),
      (15, 'Espresso yourself',                  'Double shot energy for a double shot day.'),
      (16, 'Danish invasion',                    'A pastry so good it named a whole country''s reputation. Go try one.'),
      (17, 'Cookie for breakfast? Bold. Encouraged.', 'No judgment here. Go get that cookie.'),
      (18, 'Tea leaves have spoken',             'They say: get up, get a cup, get going.'),
      (19, 'Croissant considerations',           'Buttery, flaky, layered - basically edible origami. Get one.'),
      (20, 'Matcha latte, minimal effort',       'Look put-together without doing much. Matcha''s got you.'),
      (21, 'Donut worry, be happy',              'A little glazed sugar goes a long way this morning.'),
      (22, 'The bean has spoken',                'Your coffee bean traveled far for this moment. Honor it.'),
      (23, 'Baked goods, assemble',              'Somewhere near you, an oven just finished its best work.'),
      (24, 'Chai good morning',                  'Warm spices, warmer mug, good morning.'),
      (25, 'Sconewhere over the rainbow',        'There''s a scone out there with your name on it.'),
      (26, 'Foam sweet foam',                    'A cappuccino''s foam art is basically today''s good omen.'),
      (27, 'Matcha-ing energy with intention',   'Calm focus, zero jitters. That''s the matcha way.'),
      (28, 'Pain au chocolat, or pain avoid it?', 'Chocolate croissant beats skipping breakfast. Simple math.'),
      (29, 'Tea''s up',                          'Steep something warm and let the morning catch up to you.')
    ) as messages(idx, title, body)
    where idx = msg_idx;

    perform public.notify_user(
      r.user_id,
      msg_title,
      msg_body,
      jsonb_build_object('type', 'good_morning_treat')
    );

    insert into public.good_morning_sent (user_id, last_sent_date)
    values (r.user_id, local_date)
    on conflict (user_id) do update set last_sent_date = excluded.last_sent_date;
  end loop;
end;
$$;

revoke execute on function public.send_good_morning_treat() from anon, authenticated, public;

select cron.schedule(
  'good-morning-treat',
  '*/15 * * * *',
  $$ select public.send_good_morning_treat(); $$
);
