-- Profile pictures were image uploads into the shared restaurant-images
-- bucket, which is private and requires a signed URL to display. Almost
-- every screen that shows another user's avatar (Friends, Search,
-- PublicProfile, recipe/list cards, Explore, shared lists, etc.) rendered
-- profiles.avatar_url raw/unsigned, so it silently failed to load anywhere
-- except the user's own Profile page. Replacing photo upload with a fixed
-- set of 10 emoji+color presets removes the signed-URL problem entirely
-- (no Storage object involved) and sidesteps any copyright concern, since
-- these are plain Unicode emoji rather than custom artwork.
alter table public.profiles
  add column if not exists avatar_emoji text not null default '🐶',
  add column if not exists avatar_color text not null default '#E91E63';

-- Give existing users a varied starting avatar instead of everyone
-- defaulting to the same dog/pink combo - deterministic per-user so it's
-- stable across re-runs of this migration.
with presets(idx, emoji, color) as (
  values
    (0, '🐶', '#E91E63'),
    (1, '🐱', '#9C27B0'),
    (2, '🦊', '#FF9800'),
    (3, '🐻', '#795548'),
    (4, '🐼', '#37474F'),
    (5, '🐨', '#607D8B'),
    (6, '🐯', '#FF5722'),
    (7, '🦁', '#FFC107'),
    (8, '🐸', '#4CAF50'),
    (9, '🐵', '#8D6E63')
)
update public.profiles pr
set avatar_emoji = presets.emoji,
    avatar_color = presets.color
from presets
where presets.idx = abs(hashtext(pr.user_id::text)) % 10;

-- avatar_url is left in place (nothing reads or writes it anymore) rather
-- than dropped, in case photo uploads are revisited later.
comment on column public.profiles.avatar_url is 'Deprecated - superseded by avatar_emoji/avatar_color. No longer read or written by the app.';

-- Both explore RPCs return the presenter's avatar for a card/comment -
-- swap their avatar_url output column for avatar_emoji/avatar_color to
-- match. Return type is changing, so each needs a drop before recreate.
drop function if exists public.get_explore_lists(text);

create or replace function public.get_explore_lists(p_mode text default 'all')
returns table (
  list_id uuid,
  list_name text,
  list_icon text,
  item_count integer,
  user_id uuid,
  username text,
  display_name text,
  avatar_emoji text,
  avatar_color text,
  is_anonymous boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    l.name,
    l.icon,
    count(i.id)::integer,
    l.user_id,
    case when p.is_private and l.user_id <> auth.uid() then null else p.username end,
    case when p.is_private and l.user_id <> auth.uid() then null else p.display_name end,
    case when p.is_private and l.user_id <> auth.uid() then null else p.avatar_emoji end,
    case when p.is_private and l.user_id <> auth.uid() then null else p.avatar_color end,
    (p.is_private and l.user_id <> auth.uid())
  from public.custom_lists l
  join public.profiles p on p.user_id = l.user_id
  join public.custom_list_items i on i.list_id = l.id
  where (
      l.user_id = auth.uid()
      or (
        p_mode = 'friends'
        and exists (
          select 1 from public.follows f
          where f.follower_id = auth.uid()
            and f.following_id = l.user_id
            and f.status = 'accepted'
        )
      )
      or p_mode = 'all'
    )
  group by l.id, l.name, l.icon, l.user_id, p.is_private, p.username, p.display_name, p.avatar_emoji, p.avatar_color
  order by max(i.created_at) desc;
$$;

revoke all on function public.get_explore_lists(text) from anon, public;
grant execute on function public.get_explore_lists(text) to authenticated;

drop function if exists public.get_place_comments(text, text);

create or replace function public.get_place_comments(p_place_id text, p_mode text default 'all')
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_emoji text,
  avatar_color text,
  rating integer,
  notes text,
  created_at timestamptz,
  is_anonymous boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.user_id,
    case when p.is_private and r.user_id <> auth.uid() then null else p.username end,
    case when p.is_private and r.user_id <> auth.uid() then null else p.display_name end,
    case when p.is_private and r.user_id <> auth.uid() then null else p.avatar_emoji end,
    case when p.is_private and r.user_id <> auth.uid() then null else p.avatar_color end,
    r.rating,
    r.notes,
    r.created_at,
    (p.is_private and r.user_id <> auth.uid()) as is_anonymous
  from public.restaurants r
  join public.profiles p on p.user_id = r.user_id
  where r.status = 'went_to'
    and r.address is not null
    and btrim(r.address) <> ''
    and coalesce(
      nullif(btrim(r.place_id), ''),
      'nm:' || md5(lower(btrim(r.name)) || '|' || lower(btrim(coalesce(r.address, ''))))
    ) = p_place_id
    and (
      r.user_id = auth.uid()
      or (
        p_mode = 'friends'
        and exists (
          select 1 from public.follows f
          where f.follower_id = auth.uid()
            and f.following_id = r.user_id
            and f.status = 'accepted'
        )
      )
      or p_mode = 'all'
    )
  order by r.created_at desc;
$$;

revoke all on function public.get_place_comments(text, text) from anon, public;
grant execute on function public.get_place_comments(text, text) to authenticated;

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