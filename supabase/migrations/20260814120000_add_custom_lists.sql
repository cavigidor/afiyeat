-- "My Lists": user-defined generic lists (movies, beers, books, anything),
-- separate from the restaurant-specific `restaurants`/`folders` tables.
-- Each list stores its own display config so the add-item form only shows
-- the fields that make sense for that list (a beer list might turn off
-- Address/Map and switch the value field to a 1-10 rating instead of $).

CREATE TABLE public.custom_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '📋',
  color TEXT NOT NULL DEFAULT '#E91E63',
  -- Per-list "which fields does the add-item form show" config.
  show_location BOOLEAN NOT NULL DEFAULT true,
  value_field TEXT NOT NULL DEFAULT 'price' CHECK (value_field IN ('none', 'price', 'rating')),
  show_notes BOOLEAN NOT NULL DEFAULT true,
  show_photos BOOLEAN NOT NULL DEFAULT true,
  -- Custom label pair for the two-stage status (e.g. "To Watch"/"Watched"
  -- for a movie list), defaulting to the generic To Do/Done pair.
  status_todo_label TEXT NOT NULL DEFAULT 'To Do',
  status_done_label TEXT NOT NULL DEFAULT 'Done',
  sort_order INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.custom_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES public.custom_lists(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  -- Only one of these is populated/shown, per the parent list's value_field.
  price_level INTEGER CHECK (price_level >= 1 AND price_level <= 4),
  rating INTEGER CHECK (rating >= 0 AND rating <= 10),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'done')),
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.custom_list_item_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.custom_list_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_custom_lists_user_id ON public.custom_lists(user_id);
CREATE INDEX idx_custom_list_items_list_id ON public.custom_list_items(list_id);
CREATE INDEX idx_custom_list_items_user_id ON public.custom_list_items(user_id);
CREATE INDEX idx_custom_list_item_images_item_id ON public.custom_list_item_images(item_id);

-- Explicit grants (PostgREST/the Data API needs these on top of RLS) -
-- matches the pattern the shared_lists migration already uses.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_lists TO authenticated;
GRANT ALL ON public.custom_lists TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_list_items TO authenticated;
GRANT ALL ON public.custom_list_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_list_item_images TO authenticated;
GRANT ALL ON public.custom_list_item_images TO service_role;

ALTER TABLE public.custom_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_list_item_images ENABLE ROW LEVEL SECURITY;

-- Custom lists policies (private to the owner - no shared/followed-user
-- access, unlike restaurants; this feature wasn't scoped to be social).
CREATE POLICY "Users can view their own custom lists" ON public.custom_lists FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own custom lists" ON public.custom_lists FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own custom lists" ON public.custom_lists FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own custom lists" ON public.custom_lists FOR DELETE USING (auth.uid() = user_id);

-- Custom list items policies
CREATE POLICY "Users can view their own custom list items" ON public.custom_list_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own custom list items" ON public.custom_list_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own custom list items" ON public.custom_list_items FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own custom list items" ON public.custom_list_items FOR DELETE USING (auth.uid() = user_id);

-- Custom list item images policies
CREATE POLICY "Users can view their own custom list item images" ON public.custom_list_item_images FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own custom list item images" ON public.custom_list_item_images FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own custom list item images" ON public.custom_list_item_images FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_custom_lists_updated_at BEFORE UPDATE ON public.custom_lists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_custom_list_items_updated_at BEFORE UPDATE ON public.custom_list_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for custom list item photos. Created private from the
-- start (restaurant-images started public and had to be locked down later
-- in 20260129140105_...sql - no reason to repeat that here), and since
-- custom lists aren't a shared/social feature, view access is owner-only
-- (no "shared with followers" clause like restaurant-images has).
-- 8MB file_size_limit matches imageValidation.ts's MAX_FILE_SIZE.
--
-- NOTE: storage.buckets isn't writable via a plain SQL migration in every
-- environment (the SQL editor's role doesn't have insert rights on it) - if
-- this INSERT fails, create the bucket by hand instead: Storage -> New
-- bucket -> id "custom-list-images", private, 8MB file size limit - then
-- run just the CREATE POLICY statements below.
INSERT INTO storage.buckets (id, name, public, file_size_limit) VALUES ('custom-list-images', 'custom-list-images', false, 8388608);

CREATE POLICY "Users can view their own custom list images" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'custom-list-images' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Authenticated users can upload custom list images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'custom-list-images' AND auth.uid() IS NOT NULL);
CREATE POLICY "Users can delete their own custom list images" ON storage.objects FOR DELETE USING (bucket_id = 'custom-list-images' AND auth.uid()::text = (storage.foldername(name))[1]);
