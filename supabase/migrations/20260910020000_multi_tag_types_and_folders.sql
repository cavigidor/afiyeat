-- Lets a restaurant carry more than one "type" (Bar + Cafe, etc.) and a
-- custom-list item carry more than one "type" tag, instead of the single
-- folder_id/type_id each was limited to. Non-destructive: folder_id and
-- type_id are left in place, unused going forward, and the new array
-- columns are backfilled from them so nothing changes visually the moment
-- this ships.
ALTER TABLE public.restaurants ADD COLUMN folder_ids UUID[] NOT NULL DEFAULT '{}';
UPDATE public.restaurants SET folder_ids = ARRAY[folder_id] WHERE folder_id IS NOT NULL;
CREATE INDEX idx_restaurants_folder_ids ON public.restaurants USING GIN (folder_ids);

ALTER TABLE public.custom_list_items ADD COLUMN type_ids UUID[] NOT NULL DEFAULT '{}';
UPDATE public.custom_list_items SET type_ids = ARRAY[type_id] WHERE type_id IS NOT NULL;
CREATE INDEX idx_custom_list_items_type_ids ON public.custom_list_items USING GIN (type_ids);

-- Both of these were previously only readable by their own owner, which
-- silently blanked out the "type" badge on a friend's or public profile's
-- restaurants/list items (Friends.tsx and PublicListDetail.tsx both try to
-- read them). Bring them in line with the visibility every other per-item
-- lookup table in the app already has (owner, or public profile, or
-- accepted follower), matching restaurants' and custom_list_items' own
-- policies, so the new multi-tag badges actually render for viewers.
CREATE POLICY "Users can view folders of people they follow"
  ON public.folders FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.follows f
    WHERE f.follower_id = auth.uid() AND f.following_id = folders.user_id AND f.status = 'accepted'
  ));

CREATE POLICY "Users can view folders of public profiles"
  ON public.folders FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = folders.user_id AND p.is_private = false));

CREATE POLICY "Users can view list types of public profiles"
  ON public.custom_list_types FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = custom_list_types.user_id AND p.is_private = false));

CREATE POLICY "Users can view list types of people they follow"
  ON public.custom_list_types FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.follows f
    WHERE f.follower_id = auth.uid() AND f.following_id = custom_list_types.user_id AND f.status = 'accepted'
  ));
