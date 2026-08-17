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
