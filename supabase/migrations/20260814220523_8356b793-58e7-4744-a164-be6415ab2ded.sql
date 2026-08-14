-- "Types" for My Lists: same idea as the restaurant folders/types system,
-- but scoped per-list (a movies list and a beers list want completely
-- different categories). Each type has its own name/color/emoji, and items
-- within a list can be assigned one, so the list's map can color- and
-- emoji-code pins for easy differentiation - same pattern as the restaurant
-- map pins.
CREATE TABLE public.custom_list_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES public.custom_lists(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#E91E63',
  icon TEXT,
  sort_order INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_custom_list_types_list_id ON public.custom_list_types(list_id);
CREATE INDEX idx_custom_list_types_user_id ON public.custom_list_types(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_list_types TO authenticated;
GRANT ALL ON public.custom_list_types TO service_role;

ALTER TABLE public.custom_list_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own list types"
  ON public.custom_list_types FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own list types"
  ON public.custom_list_types FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own list types"
  ON public.custom_list_types FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own list types"
  ON public.custom_list_types FOR DELETE
  USING (auth.uid() = user_id);

-- Let items reference a type within their list. ON DELETE SET NULL so
-- deleting a type just un-categorizes its items instead of deleting them.
ALTER TABLE public.custom_list_items ADD COLUMN type_id UUID REFERENCES public.custom_list_types(id) ON DELETE SET NULL;
CREATE INDEX idx_custom_list_items_type_id ON public.custom_list_items(type_id);

-- Price and rating were a single "value_field" toggle (none/price/rating) -
-- split into two independent settings, each with its own entry mode, so a
-- list can show both (or neither, or just one) and pick how each is entered.
ALTER TABLE public.custom_lists ADD COLUMN show_price BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.custom_lists ADD COLUMN price_mode TEXT NOT NULL DEFAULT 'dollar' CHECK (price_mode IN ('manual', 'dollar'));
ALTER TABLE public.custom_lists ADD COLUMN show_rating BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.custom_lists ADD COLUMN rating_mode TEXT NOT NULL DEFAULT 'scale_10' CHECK (rating_mode IN ('scale_10', 'stars_5', 'manual'));

-- Backfill from the old single value_field so existing lists keep their
-- current behavior exactly (price lists stay $ price, rating lists stay
-- 0-10 rating).
UPDATE public.custom_lists
SET show_price = (value_field = 'price'),
    show_rating = (value_field = 'rating'),
    rating_mode = 'scale_10';

ALTER TABLE public.custom_lists DROP COLUMN value_field;

-- Free-entry values for each field's "manual" mode - a price or rating the
-- user just types in, rather than picking from the structured $ / 0-10 /
-- 5-star controls. Unconstrained (unlike price_level and rating) since a
-- manually-entered value isn't bound to those fixed scales.
ALTER TABLE public.custom_list_items ADD COLUMN price_manual NUMERIC;
ALTER TABLE public.custom_list_items ADD COLUMN rating_manual NUMERIC;