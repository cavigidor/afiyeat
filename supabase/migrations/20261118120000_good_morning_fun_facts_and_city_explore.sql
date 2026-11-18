-- Daily engagement notifications: at most three a day, at a fixed local time
-- in the user's own saved timezone (profiles.timezone, which the app saves
-- at sign-in and whenever it returns to the foreground with a new zone):
--
--   7am  good_morning_fun_fact  "Good morning!" + a fact about animals, the
--                               world, nature or space (60, one per day).
--   8am  morning_explore        Explore your city (30 ideas).
--   5pm  evening_explore        Evening city exploration (40 ideas). Cafés and
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
    array[
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!',
      'Good morning!'
    ],
    array[
      '🐾 Octopuses have three hearts and blue blood.',
      '🌍 Australia is wider than the Moon.',
      '🌿 Bananas are berries, but strawberries aren''t.',
      '🚀 A day on Venus is longer than its whole year.',
      '🐾 A group of flamingos is called a flamboyance.',
      '🌍 Canada has more lakes than the rest of the world combined.',
      '🌿 A bolt of lightning can be about five times hotter than the surface of the Sun.',
      '🚀 A teaspoon of neutron star would weigh about a billion tons on Earth.',
      '🐾 Wombats poop in little cubes, which helps the droppings stay put on rocks and logs.',
      '🌍 There''s a village in Norway called Hell, and it freezes over most winters.',
      '🌿 Some kinds of bamboo can grow nearly 90 cm (3 feet) in a single day.',
      '🚀 The footprints on the Moon could last for millions of years - there''s no wind to blow them away.',
      '🐾 Koala fingerprints are so similar to ours that they can be hard to tell apart, even under a microscope.',
      '🌍 Istanbul sits on two continents at once: Europe and Asia.',
      '🌿 There are more trees on Earth (about 3 trillion) than stars in the Milky Way.',
      '🚀 Sunlight takes about 8 minutes to reach Earth, so you always see the Sun as it was 8 minutes ago.',
      '🐾 Butterflies taste with their feet.',
      '🌍 The world''s shortest scheduled flight, between two Scottish islands, takes about 90 seconds.',
      '🌿 Rainbows are actually full circles. From the ground, the horizon hides the bottom half.',
      '🚀 Saturn is less dense than water. In a big enough bathtub, it would float.',
      '🐾 Crows can recognize individual human faces and remember them for years.',
      '🌍 Oxford University is older than the Aztec Empire.',
      '🌿 Sealed honey can last for thousands of years - pots of it have turned up in ancient Egyptian tombs.',
      '🚀 Astronauts say space smells like seared steak, hot metal and welding fumes.',
      '🐾 Dolphins use signature whistles that work a lot like names.',
      '🌍 France spans 12 time zones, more than any other country, thanks to its overseas territories.',
      '🌿 A pineapple plant takes about two years to grow a single pineapple.',
      '🚀 Jupiter''s Great Red Spot is a storm that''s bigger than Earth.',
      '🐾 A shrimp''s heart is in its head.',
      '🌍 Lake Baikal in Siberia holds roughly a fifth of all the unfrozen fresh surface water on Earth.',
      '🌿 Snowflakes almost always have six sides or six arms.',
      '🚀 About 1.3 million Earths could fit inside the Sun.',
      '🐾 Owls can''t move their eyes, so they turn their heads up to 270 degrees instead.',
      '🌍 The Eiffel Tower grows up to about 15 cm (6 inches) taller in summer as its iron expands.',
      '🌿 Young sunflowers follow the Sun across the sky all day, then turn back east overnight.',
      '🚀 The Space Station circles Earth every 90 minutes or so, so astronauts see about 16 sunrises a day.',
      '🐾 Male seahorses are the ones who carry the babies and give birth.',
      '🌍 Around 6,000 years ago the Sahara was green, with lakes, grasslands and hippos.',
      '🌿 Most of the ocean floor still hasn''t been mapped in high detail.',
      '🚀 Olympus Mons, a volcano on Mars, is about two and a half times taller than Mount Everest.',
      '🐾 Giraffes have seven neck bones - the same number as you.',
      '🌍 Alaska is the most northern, western and eastern US state all at once.',
      '🌿 Forgetful squirrels help plant forests: some of the nuts they bury and never dig up sprout into trees.',
      '🚀 Uranus spins on its side, tipped over at about 98 degrees.',
      '🐾 Sharks have been around longer than trees.',
      '🌍 Russia stretches across 11 time zones.',
      '🌿 Peanuts aren''t nuts - they''re legumes, like beans and peas.',
      '🚀 Sunsets on Mars glow blue.',
      '🐾 Polar bears have black skin, and their fur isn''t really white - each hair is see-through.',
      '🌍 Vatican City is the smallest country in the world - smaller than many city parks.',
      '🌿 One of the oldest known living trees, a bristlecone pine in California, is over 4,800 years old.',
      '🚀 Halley''s Comet swings past Earth about every 76 years. Its next visit is in 2061.',
      '🐾 Sea otters sometimes hold paws while they sleep so they don''t drift apart.',
      '🌍 The Dead Sea is so salty that you float without even trying.',
      '🌿 Coral reefs cover less than 1% of the ocean floor but are home to about a quarter of all ocean species.',
      '🚀 Astronomers estimate there are more stars in the universe than grains of sand on all of Earth''s beaches.',
      '🐾 Axolotls can regrow lost legs, and even parts of their heart and brain.',
      '🌍 More than a third of everyone on Earth lives in just two countries: India and China.',
      '🌿 Venus flytraps can count: they only snap shut after their trigger hairs are touched twice.',
      '🚀 Earth isn''t a perfect ball - it bulges at the equator because it spins.'
    ],
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
    array[
      'Today''s mini adventure',
      'New route, new finds',
      'Coffee with a view',
      'Explore like a local',
      'Free is fun',
      'Garden check',
      'Library field trip',
      'Climb for the view',
      'Neighborhood bingo',
      'Sunset plans',
      'Pop-up hunt',
      'Wander a little',
      'Local landmark day',
      'Thrift treasure hunt',
      'Green space reset',
      'Architecture walk',
      'Two wheels',
      'Gallery hop',
      'Tourist for a day',
      'Find your third place',
      'Water day',
      'Check the calendar',
      'Explore your own block',
      'Sculpture spotting',
      'Weekend scouting',
      'Step inside',
      'Historic stroll',
      'Photo walk',
      'Hidden courtyards',
      'Start an explore list'
    ],
    array[
      'Pick one street, park or shop you''ve never been to and check it out today.',
      'Take a different way to wherever you''re going today. See what you spot.',
      'Grab a coffee somewhere new and drink it outside.',
      'Ask a barista or shop owner for their favorite spot nearby, then go.',
      'Free museums, parks, public gardens - your city has more free stuff than you think.',
      'Look up a botanical or community garden near you. Perfect for a slow morning.',
      'Big city libraries are often stunning buildings. Go take a look inside.',
      'Find the highest point in your city - a hill, a tower, a top-floor café - and look out.',
      'Walk through a neighborhood you''ve never visited. Bonus points for a new café.',
      'Pick a spot you''ve never watched the sunset from and go this week.',
      'Pop-up markets and shops come and go. See what''s popping up near you.',
      'Take a 20-minute walk in a direction you never go.',
      'There''s a landmark in your city you''ve never actually visited. Today''s the day.',
      'Pop into a vintage or thrift shop you''ve never been in. Treasure hunting counts.',
      'Start the day in a park you don''t usually go to. Fresh air, new view.',
      'Find the most interesting building near you and go see it up close.',
      'Rent a bike or scooter and explore a part of town you''d never walk to.',
      'Small galleries are usually free to walk into. Find one near you this week.',
      'What would a visitor do in your city? Do one of those things this week.',
      'Not home, not work: a café, a bench, a bookstore. Go find your spot.',
      'Find a fountain, pond, beach or riverwalk near you and spend some time there.',
      'Festivals, fairs, free concerts - see what''s on in your city this week.',
      'There''s a spot within 10 minutes of home you''ve never noticed. Go look.',
      'Public art hides in plain sight. Find a statue or sculpture you''ve never really looked at.',
      'Pick one new place to explore this weekend and add it to a list on Afiyeat.',
      'That place you always walk past but never go into? Go in today.',
      'Find your city''s oldest street or district and take a walk through it.',
      'Go on a walk just to take photos. You''ll notice things you''ve passed for years.',
      'Cities are full of hidden courtyards and rooftop gardens. Go find one.',
      'Make an Afiyeat list of places in your city you want to visit, and tick one off.'
    ],
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
    array[
      'Golden hour is coming',
      'Be a tourist at home',
      'Museum mood',
      'Take the long way',
      'Night market hunt',
      'New neighborhood unlocked',
      'Bookstore wander',
      'Hidden green',
      'What''s on tonight?',
      'Look up',
      'Ride somewhere new',
      'Street art safari',
      'Waterfront walk',
      'Neon & signs',
      'Ferry, tram or cable car',
      'After-dark stroll',
      'Say yes to the detour',
      'Window shopping, upgraded',
      'Evening picnic',
      'Dinner in a new neighborhood',
      'New café, new corner',
      'Live music check',
      'Rooftop hunt',
      'Stargazing spot',
      'Main street, new town',
      'Late sweet stop',
      'Bridge at dusk',
      'Cinema night',
      'Small stages',
      'City lights',
      'Tea house hideaway',
      'Weekend explore plan',
      'Food hall wander',
      'Plaza people-watching',
      'Off the main road',
      'Festival check',
      'Evening market',
      'Historic quarter at night',
      'Ask the locals',
      'Save your find'
    ],
    array[
      'Find a park, rooftop or riverside spot with a view and catch the sunset.',
      'Pick one spot in your city you''ve never been to and go this week.',
      'Lots of museums have free or late nights. See what''s on near you this week.',
      'Walk a street you''ve never walked. The best finds hide one block over.',
      'Night markets, food halls, late bazaars - find one and wander through.',
      'Pick a neighborhood you only know by name and spend an evening there.',
      'Get lost in an indie bookstore. Leave with something you didn''t plan on.',
      'Your city has a park you''ve never set foot in. Go find it.',
      'Live music, comedy, a gallery opening - see what''s happening near you.',
      'On your next walk, look above street level. Old signs, murals and rooftops are everywhere.',
      'Take a bus or train line you never use and hop off somewhere new.',
      'Hunt down a mural or two in your city, then add a spot nearby to your list.',
      'River, lake or harbor - head to the water and take a slow lap.',
      'Find the best old neon sign in your city. Evenings are when they shine.',
      'If your city has one, ride it at dusk just for the view.',
      'Some streets look completely different lit up. Take an evening walk somewhere new.',
      'That spot you pass on your commute? Today''s the day you stop in.',
      'Wander a street of small shops you''ve never browsed.',
      'Grab something from a local deli or bakery and eat it in a park.',
      'Pick a restaurant somewhere you''ve never explored and make an evening of it.',
      'Try a café in a part of town you never visit. Grab a window seat and people-watch.',
      'Find a small venue with live music this week. Jazz, open mic, anything goes.',
      'Rooftops, terraces, top-floor cafés - find a high spot for tonight''s sky.',
      'Find a park away from the brightest city lights and look up after dark.',
      'Walk the main street of a neighborhood you only know from the car window.',
      'Track down a dessert shop open late in a part of town you rarely visit.',
      'Walk across a bridge in your city around sunset. The view is usually worth it.',
      'Find an independent cinema or an outdoor screening near you.',
      'Small theaters and comedy clubs are local treasures. See what''s on this week.',
      'Head somewhere known for its lights - a skyline view, a lit-up square, a busy avenue.',
      'Find a quiet tea house or café you''ve never been to and take the evening slow.',
      'Pick one neighborhood for the weekend and save three spots there on Afiyeat.',
      'A food hall is a whole neighborhood under one roof. Go explore one.',
      'Find a busy square, grab a bench and watch the city go by.',
      'Every city has a spot down an alley or up a staircase. Go find one.',
      'Fairs and street festivals pop up all year. See if one''s on near you.',
      'Some markets come alive after work. Find one and browse with no plan.',
      'Old town, historic district, cobbled lane - they glow after dark. Go see.',
      'Ask someone who lives nearby for their favorite hidden spot, then go this week.',
      'Explored somewhere new today? Save it on Afiyeat so you can find it again.'
    ],
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
