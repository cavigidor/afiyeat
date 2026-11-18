-- Notification refresh: three daily pushes, each at a set local time in the
-- user's own timezone (profiles.timezone, which the app keeps fresh on
-- every sign-in and cold start):
--
--   7am  Good morning + a fun fact about animals, the world, nature or
--        space. 60 facts, so nothing repeats for about two months.
--   8am  Explore your city: one idea for getting out and seeing something
--        new today (parks, landmarks, galleries, markets, new neighborhoods).
--        Replaces the old 8am "go get a treat" push. 30 ideas.
--   5pm  Daily prompt: alternates food spots with evening/weekend
--        explore-the-city ideas. 40 messages. This used to go out at
--        11pm UTC for everyone (2am in Istanbul).
--
-- Users without a saved timezone: skipped at 7am and 8am (so nobody is woken
-- at 1am), and keep the old 11pm UTC for the 5pm prompt. They move onto
-- their local times as soon as they next open the app.
--
-- Same recipients as before (everyone with a registered device), same
-- notify_user() delivery path.
--
-- Rollback: unschedule 'good-morning-fun-fact' and 'morning-explore',
-- re-schedule 'good-morning-treat' ('*/15 * * * *',
-- select public.send_good_morning_treat()), and restore send_daily_prompt /
-- 'daily-prompt' from 20260816211302_bf5fbf99-4a4c-44b5-957c-b08030ba7f7c.sql.
-- send_good_morning_treat() is intentionally left in place for that reason.

-- Per-user "already sent today" guard for the 8am and 5pm pushes (the 7am
-- one keeps using the existing good_morning_sent). The crons run every 15
-- minutes and check each user's own local hour, so without this a user
-- would get the same push up to 4 times in that hour. Service role only.
create table if not exists public.daily_push_sent (
  user_id uuid not null references auth.users(id) on delete cascade,
  push_kind text not null,
  last_sent_date date not null,
  primary key (user_id, push_kind)
);

grant all on public.daily_push_sent to service_role;
alter table public.daily_push_sent enable row level security;

-- ---------------------------------------------------------------------
-- 7am: Good morning + fun fact
-- ---------------------------------------------------------------------

create or replace function public.send_good_morning_fun_fact()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  local_now timestamp;
  local_date date;
  msg_idx int;
  msg_title text;
  msg_body text;
begin
  for r in
    select distinct dt.user_id, p.timezone as tz
    from public.device_tokens dt
    join public.profiles p on p.user_id = dt.user_id
    where p.timezone is not null
  loop
    -- Skip anything that isn't a real IANA zone name rather than let
    -- AT TIME ZONE error out and abort the whole loop.
    begin
      local_now := now() at time zone r.tz;
    exception when others then
      continue;
    end;
    local_date := local_now::date;

    if extract(hour from local_now)::int <> 7 then
      continue;
    end if;

    if exists (
      select 1 from public.good_morning_sent
      where user_id = r.user_id and last_sent_date = local_date
    ) then
      continue;
    end if;

    msg_idx := extract(doy from local_date)::int % 60;

    select title, body into msg_title, msg_body
    from (values
      ( 0, 'Good morning! 🐾 Today''s animal fact', 'Octopuses have three hearts and blue blood.'),
      ( 1, 'Good morning! 🌍 Today''s world fact', 'Australia is wider than the Moon.'),
      ( 2, 'Good morning! 🌿 Today''s nature fact', 'Bananas are berries, but strawberries aren''t.'),
      ( 3, 'Good morning! 🚀 Today''s space fact', 'A day on Venus is longer than its whole year.'),
      ( 4, 'Good morning! 🐾 Today''s animal fact', 'A group of flamingos is called a flamboyance.'),
      ( 5, 'Good morning! 🌍 Today''s world fact', 'Canada has more lakes than the rest of the world combined.'),
      ( 6, 'Good morning! 🌿 Today''s nature fact', 'A bolt of lightning can be about five times hotter than the surface of the Sun.'),
      ( 7, 'Good morning! 🚀 Today''s space fact', 'A teaspoon of neutron star would weigh about a billion tons on Earth.'),
      ( 8, 'Good morning! 🐾 Today''s animal fact', 'Wombats poop in little cubes, which helps the droppings stay put on rocks and logs.'),
      ( 9, 'Good morning! 🌍 Today''s world fact', 'There''s a village in Norway called Hell, and it freezes over most winters.'),
      (10, 'Good morning! 🌿 Today''s nature fact', 'Some kinds of bamboo can grow nearly 90 cm (3 feet) in a single day.'),
      (11, 'Good morning! 🚀 Today''s space fact', 'The footprints on the Moon could last for millions of years - there''s no wind to blow them away.'),
      (12, 'Good morning! 🐾 Today''s animal fact', 'Koala fingerprints are so similar to ours that they can be hard to tell apart, even under a microscope.'),
      (13, 'Good morning! 🌍 Today''s world fact', 'Istanbul sits on two continents at once: Europe and Asia.'),
      (14, 'Good morning! 🌿 Today''s nature fact', 'There are more trees on Earth (about 3 trillion) than stars in the Milky Way.'),
      (15, 'Good morning! 🚀 Today''s space fact', 'Sunlight takes about 8 minutes to reach Earth, so you always see the Sun as it was 8 minutes ago.'),
      (16, 'Good morning! 🐾 Today''s animal fact', 'Butterflies taste with their feet.'),
      (17, 'Good morning! 🌍 Today''s world fact', 'The world''s shortest scheduled flight, between two Scottish islands, takes about 90 seconds.'),
      (18, 'Good morning! 🌿 Today''s nature fact', 'Rainbows are actually full circles. From the ground, the horizon hides the bottom half.'),
      (19, 'Good morning! 🚀 Today''s space fact', 'Saturn is less dense than water. In a big enough bathtub, it would float.'),
      (20, 'Good morning! 🐾 Today''s animal fact', 'Crows can recognize individual human faces and remember them for years.'),
      (21, 'Good morning! 🌍 Today''s world fact', 'Oxford University is older than the Aztec Empire.'),
      (22, 'Good morning! 🌿 Today''s nature fact', 'Sealed honey can last for thousands of years - pots of it have turned up in ancient Egyptian tombs.'),
      (23, 'Good morning! 🚀 Today''s space fact', 'Astronauts say space smells like seared steak, hot metal and welding fumes.'),
      (24, 'Good morning! 🐾 Today''s animal fact', 'Dolphins use signature whistles that work a lot like names.'),
      (25, 'Good morning! 🌍 Today''s world fact', 'France spans 12 time zones, more than any other country, thanks to its overseas territories.'),
      (26, 'Good morning! 🌿 Today''s nature fact', 'A pineapple plant takes about two years to grow a single pineapple.'),
      (27, 'Good morning! 🚀 Today''s space fact', 'Jupiter''s Great Red Spot is a storm that''s bigger than Earth.'),
      (28, 'Good morning! 🐾 Today''s animal fact', 'A shrimp''s heart is in its head.'),
      (29, 'Good morning! 🌍 Today''s world fact', 'Lake Baikal in Siberia holds roughly a fifth of all the unfrozen fresh surface water on Earth.'),
      (30, 'Good morning! 🌿 Today''s nature fact', 'Snowflakes almost always have six sides or six arms.'),
      (31, 'Good morning! 🚀 Today''s space fact', 'About 1.3 million Earths could fit inside the Sun.'),
      (32, 'Good morning! 🐾 Today''s animal fact', 'Owls can''t move their eyes, so they turn their heads up to 270 degrees instead.'),
      (33, 'Good morning! 🌍 Today''s world fact', 'The Eiffel Tower grows up to about 15 cm (6 inches) taller in summer as its iron expands.'),
      (34, 'Good morning! 🌿 Today''s nature fact', 'Young sunflowers follow the Sun across the sky all day, then turn back east overnight.'),
      (35, 'Good morning! 🚀 Today''s space fact', 'The Space Station circles Earth every 90 minutes or so, so astronauts see about 16 sunrises a day.'),
      (36, 'Good morning! 🐾 Today''s animal fact', 'Male seahorses are the ones who carry the babies and give birth.'),
      (37, 'Good morning! 🌍 Today''s world fact', 'Around 6,000 years ago the Sahara was green, with lakes, grasslands and hippos.'),
      (38, 'Good morning! 🌿 Today''s nature fact', 'Most of the ocean floor still hasn''t been mapped in high detail.'),
      (39, 'Good morning! 🚀 Today''s space fact', 'Olympus Mons, a volcano on Mars, is about two and a half times taller than Mount Everest.'),
      (40, 'Good morning! 🐾 Today''s animal fact', 'Giraffes have seven neck bones - the same number as you.'),
      (41, 'Good morning! 🌍 Today''s world fact', 'Alaska is the most northern, western and eastern US state all at once.'),
      (42, 'Good morning! 🌿 Today''s nature fact', 'Forgetful squirrels help plant forests: some of the nuts they bury and never dig up sprout into trees.'),
      (43, 'Good morning! 🚀 Today''s space fact', 'Uranus spins on its side, tipped over at about 98 degrees.'),
      (44, 'Good morning! 🐾 Today''s animal fact', 'Sharks have been around longer than trees.'),
      (45, 'Good morning! 🌍 Today''s world fact', 'Russia stretches across 11 time zones.'),
      (46, 'Good morning! 🌿 Today''s nature fact', 'Peanuts aren''t nuts - they''re legumes, like beans and peas.'),
      (47, 'Good morning! 🚀 Today''s space fact', 'Sunsets on Mars glow blue.'),
      (48, 'Good morning! 🐾 Today''s animal fact', 'Polar bears have black skin, and their fur isn''t really white - each hair is see-through.'),
      (49, 'Good morning! 🌍 Today''s world fact', 'Vatican City is the smallest country in the world - smaller than many city parks.'),
      (50, 'Good morning! 🌿 Today''s nature fact', 'One of the oldest known living trees, a bristlecone pine in California, is over 4,800 years old.'),
      (51, 'Good morning! 🚀 Today''s space fact', 'Halley''s Comet swings past Earth about every 76 years. Its next visit is in 2061.'),
      (52, 'Good morning! 🐾 Today''s animal fact', 'Sea otters sometimes hold paws while they sleep so they don''t drift apart.'),
      (53, 'Good morning! 🌍 Today''s world fact', 'The Dead Sea is so salty that you float without even trying.'),
      (54, 'Good morning! 🌿 Today''s nature fact', 'Coral reefs cover less than 1% of the ocean floor but are home to about a quarter of all ocean species.'),
      (55, 'Good morning! 🚀 Today''s space fact', 'Astronomers estimate there are more stars in the universe than grains of sand on all of Earth''s beaches.'),
      (56, 'Good morning! 🐾 Today''s animal fact', 'Axolotls can regrow lost legs, and even parts of their heart and brain.'),
      (57, 'Good morning! 🌍 Today''s world fact', 'More than a third of everyone on Earth lives in just two countries: India and China.'),
      (58, 'Good morning! 🌿 Today''s nature fact', 'Venus flytraps can count: they only snap shut after their trigger hairs are touched twice.'),
      (59, 'Good morning! 🚀 Today''s space fact', 'Earth isn''t a perfect ball - it bulges at the equator because it spins.')
    ) as facts(idx, title, body)
    where idx = msg_idx;

    perform public.notify_user(
      r.user_id,
      msg_title,
      msg_body,
      jsonb_build_object('type', 'good_morning_fun_fact')
    );

    insert into public.good_morning_sent (user_id, last_sent_date)
    values (r.user_id, local_date)
    on conflict (user_id) do update set last_sent_date = excluded.last_sent_date;
  end loop;
end;
$$;

revoke execute on function public.send_good_morning_fun_fact() from anon, authenticated, public;

select cron.unschedule('good-morning-fun-fact')
where exists (select 1 from cron.job where jobname = 'good-morning-fun-fact');

select cron.schedule(
  'good-morning-fun-fact',
  '*/15 * * * *',
  $$ select public.send_good_morning_fun_fact(); $$
);

-- ---------------------------------------------------------------------
-- 8am: Explore your city (replaces the 8am treat push)
-- ---------------------------------------------------------------------

create or replace function public.send_morning_explore()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  local_now timestamp;
  local_date date;
  msg_idx int;
  msg_title text;
  msg_body text;
begin
  for r in
    select distinct dt.user_id, p.timezone as tz
    from public.device_tokens dt
    join public.profiles p on p.user_id = dt.user_id
    where p.timezone is not null
  loop
    begin
      local_now := now() at time zone r.tz;
    exception when others then
      continue;
    end;
    local_date := local_now::date;

    if extract(hour from local_now)::int <> 8 then
      continue;
    end if;

    if exists (
      select 1 from public.daily_push_sent
      where user_id = r.user_id
        and push_kind = 'morning_explore'
        and last_sent_date = local_date
    ) then
      continue;
    end if;

    msg_idx := extract(doy from local_date)::int % 30;

    select title, body into msg_title, msg_body
    from (values
      ( 0, 'Today''s mini adventure', 'Pick one street, park or shop you''ve never been to and check it out today.'),
      ( 1, 'New route, new finds', 'Take a different way to wherever you''re going today. See what you spot.'),
      ( 2, 'Coffee with a view', 'Grab a coffee somewhere new and drink it outside.'),
      ( 3, 'Explore like a local', 'Ask a barista or shop owner for their favorite spot nearby, then go.'),
      ( 4, 'Free is fun', 'Free museums, parks, public gardens - your city has more free stuff than you think.'),
      ( 5, 'Garden check', 'Look up a botanical or community garden near you. Perfect for a slow morning.'),
      ( 6, 'Library field trip', 'Big city libraries are often stunning buildings. Go take a look inside.'),
      ( 7, 'Climb for the view', 'Find the highest point in your city - a hill, a tower, a top-floor café - and look out.'),
      ( 8, 'Neighborhood bingo', 'Walk through a neighborhood you''ve never visited. Bonus points for a new café.'),
      ( 9, 'Sunset plans', 'Pick a spot you''ve never watched the sunset from and go this week.'),
      (10, 'Pop-up hunt', 'Pop-up markets and shops come and go. See what''s popping up near you.'),
      (11, 'Wander a little', 'Take a 20-minute walk in a direction you never go.'),
      (12, 'Local landmark day', 'There''s a landmark in your city you''ve never actually visited. Today''s the day.'),
      (13, 'Thrift treasure hunt', 'Pop into a vintage or thrift shop you''ve never been in. Treasure hunting counts.'),
      (14, 'Green space reset', 'Start the day in a park you don''t usually go to. Fresh air, new view.'),
      (15, 'Architecture walk', 'Find the most interesting building near you and go see it up close.'),
      (16, 'Two wheels', 'Rent a bike or scooter and explore a part of town you''d never walk to.'),
      (17, 'Gallery hop', 'Small galleries are usually free to walk into. Find one near you this week.'),
      (18, 'Tourist for a day', 'What would a visitor do in your city? Do one of those things this week.'),
      (19, 'Find your third place', 'Not home, not work: a café, a bench, a bookstore. Go find your spot.'),
      (20, 'Water day', 'Find a fountain, pond, beach or riverwalk near you and spend some time there.'),
      (21, 'Check the calendar', 'Festivals, fairs, free concerts - see what''s on in your city this week.'),
      (22, 'Explore your own block', 'There''s a spot within 10 minutes of home you''ve never noticed. Go look.'),
      (23, 'Sculpture spotting', 'Public art hides in plain sight. Find a statue or sculpture you''ve never really looked at.'),
      (24, 'Weekend scouting', 'Pick one new place to explore this weekend and add it to a list on Afiyeat.'),
      (25, 'Step inside', 'That place you always walk past but never go into? Go in today.'),
      (26, 'Historic stroll', 'Find your city''s oldest street or district and take a walk through it.'),
      (27, 'Photo walk', 'Go on a walk just to take photos. You''ll notice things you''ve passed for years.'),
      (28, 'Hidden courtyards', 'Cities are full of hidden courtyards and rooftop gardens. Go find one.'),
      (29, 'Start an explore list', 'Make an Afiyeat list of places in your city you want to visit, and tick one off.')
    ) as ideas(idx, title, body)
    where idx = msg_idx;

    perform public.notify_user(
      r.user_id,
      msg_title,
      msg_body,
      jsonb_build_object('type', 'morning_explore')
    );

    insert into public.daily_push_sent (user_id, push_kind, last_sent_date)
    values (r.user_id, 'morning_explore', local_date)
    on conflict (user_id, push_kind) do update set last_sent_date = excluded.last_sent_date;
  end loop;
end;
$$;

revoke execute on function public.send_morning_explore() from anon, authenticated, public;

select cron.unschedule('good-morning-treat')
where exists (select 1 from cron.job where jobname = 'good-morning-treat');

select cron.unschedule('morning-explore')
where exists (select 1 from cron.job where jobname = 'morning-explore');

select cron.schedule(
  'morning-explore',
  '*/15 * * * *',
  $$ select public.send_morning_explore(); $$
);

-- ---------------------------------------------------------------------
-- 5pm: daily prompt, food + exploring the city
-- ---------------------------------------------------------------------

create or replace function public.send_daily_prompt()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  local_now timestamp;
  local_date date;
  target_hour int;
  msg_idx int;
  msg_title text;
  msg_body text;
begin
  for r in
    select distinct dt.user_id, p.timezone as tz
    from public.device_tokens dt
    left join public.profiles p on p.user_id = dt.user_id
  loop
    begin
      local_now := now() at time zone coalesce(r.tz, 'UTC');
    exception when others then
      continue;
    end;
    local_date := local_now::date;

    -- 5pm local. Unknown timezone keeps the previous fixed 11pm UTC.
    target_hour := case when r.tz is null then 23 else 17 end;
    if extract(hour from local_now)::int <> target_hour then
      continue;
    end if;

    if exists (
      select 1 from public.daily_push_sent
      where user_id = r.user_id
        and push_kind = 'daily_prompt'
        and last_sent_date = local_date
    ) then
      continue;
    end if;

    -- Even = food, odd = exploring the city.
    msg_idx := extract(doy from local_date)::int % 40;

    select title, body into msg_title, msg_body
    from (values
      ( 0, 'What''s on the table today?', 'Log a place you visited today before you forget the details.'),
      ( 1, 'Be a tourist at home', 'Pick one spot in your city you''ve never been to and go this week.'),
      ( 2, 'Dinner, but make it new', 'Try a cuisine you''ve never had. Your list could use a plot twist.'),
      ( 3, 'Golden hour is coming', 'Find a park, rooftop or riverside spot with a view and catch the sunset.'),
      ( 4, 'Rate it while it''s fresh', 'Had something good today? Rate it while you still remember the taste.'),
      ( 5, 'Take the long way', 'Walk a street you''ve never walked. The best finds hide one block over.'),
      ( 6, 'Your To Go list is waiting', 'Pick one place off your To Go list and make it happen this week.'),
      ( 7, 'Museum mood', 'Lots of museums have free or cheap nights. See what''s near you this week.'),
      ( 8, 'Snap, rate, remember', 'A quick photo and a rating now saves you from "where was that place?" later.'),
      ( 9, 'Market day', 'Farmers market, flea market, night market - go browse one this weekend.'),
      (10, 'Dessert detour', 'Find the best dessert spot near you. Strictly for research purposes.'),
      (11, 'New neighborhood unlocked', 'Pick a neighborhood you only know by name and spend an afternoon there.'),
      (12, 'Hole-in-the-wall hunt', 'The best meals hide in the smallest spots. Go find one.'),
      (13, 'Bookstore wander', 'Get lost in an indie bookstore. Leave with something you didn''t plan on.'),
      (14, 'Coffee scouting', 'Line up a new café for tomorrow''s morning cup.'),
      (15, 'Hidden green', 'Your city has a park you''ve never set foot in. Go find it.'),
      (16, 'Plan a bakery run', 'Tomorrow morning: one new bakery, one croissant, zero regrets.'),
      (17, 'What''s on tonight?', 'Live music, comedy, a gallery opening - see what''s happening near you.'),
      (18, 'Food truck roulette', 'Spot a food truck with a line? Follow the line. It''s usually right.'),
      (19, 'Look up', 'On your next walk, look above street level. Old signs, murals and rooftops are everywhere.'),
      (20, 'Better together', 'Good food tastes better shared. Invite someone to your next spot.'),
      (21, 'Ride somewhere new', 'Take a bus or train line you never use and hop off somewhere new.'),
      (22, 'Late-night bites', 'Find the place locals go after 10pm. Every city has one.'),
      (23, 'Street art safari', 'Hunt down a mural or two in your city, then add a spot nearby to your list.'),
      (24, 'Staying in tonight?', 'Try a new recipe and save it to Afiyeat so you can make it again.'),
      (25, 'Waterfront walk', 'River, lake or harbor - head to the water and take a slow lap.'),
      (26, 'Street food night', 'Skip the sit-down. Grab something you can eat while you walk.'),
      (27, 'Weekend plan, sorted', 'Pick one new place to visit and one new place to eat. Done.'),
      (28, 'Tea time', 'A good tea house is a quiet kind of treasure. Find one near you.'),
      (29, 'Local history moment', 'Find the oldest building in your neighborhood. There''s always a story.'),
      (30, 'Spice it up', 'Order the dish you can''t pronounce. Worst case, you get a good story.'),
      (31, 'Say yes to the detour', 'That spot you pass on your commute? Today''s the day you stop in.'),
      (32, 'Sweet tooth check-in', 'Ice cream, baklava, churros - something sweet is calling.'),
      (33, 'Find a view', 'Every city has a lookout spot locals love. Go find yours.'),
      (34, 'Brunch scouting', 'Plan ahead: line up a new brunch spot for the weekend.'),
      (35, 'Window shopping, upgraded', 'Wander a street of small shops you''ve never browsed.'),
      (36, 'What did you eat today?', 'Tell your future self. Log it on Afiyeat.'),
      (37, 'Picnic weather?', 'Grab something from a local deli or bakery and eat it in a park.'),
      (38, 'Afiyet olsun!', 'Wherever you ate today, we hope it was delicious. Log it so you can find it again.'),
      (39, 'Explorer mode: on', 'Somewhere in your city is your next favorite spot. Go find it, then log it.')
    ) as prompts(idx, title, body)
    where idx = msg_idx;

    perform public.notify_user(
      r.user_id,
      msg_title,
      msg_body,
      jsonb_build_object(
        'type', 'daily_prompt',
        'topic', case when msg_idx % 2 = 0 then 'food' else 'explore' end
      )
    );

    insert into public.daily_push_sent (user_id, push_kind, last_sent_date)
    values (r.user_id, 'daily_prompt', local_date)
    on conflict (user_id, push_kind) do update set last_sent_date = excluded.last_sent_date;
  end loop;
end;
$$;

revoke execute on function public.send_daily_prompt() from anon, authenticated, public;

select cron.unschedule('daily-prompt')
where exists (select 1 from cron.job where jobname = 'daily-prompt');

select cron.schedule(
  'daily-prompt',
  '*/15 * * * *',
  $$ select public.send_daily_prompt(); $$
);
