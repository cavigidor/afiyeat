ALTER TABLE public.restaurants ADD COLUMN folder_ids UUID[] NOT NULL DEFAULT '{}';
UPDATE public.restaurants SET folder_ids = ARRAY[folder_id] WHERE folder_id IS NOT NULL;
CREATE INDEX idx_restaurants_folder_ids ON public.restaurants USING GIN (folder_ids);

ALTER TABLE public.custom_list_items ADD COLUMN type_ids UUID[] NOT NULL DEFAULT '{}';
UPDATE public.custom_list_items SET type_ids = ARRAY[type_id] WHERE type_id IS NOT NULL;
CREATE INDEX idx_custom_list_items_type_ids ON public.custom_list_items USING GIN (type_ids);

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