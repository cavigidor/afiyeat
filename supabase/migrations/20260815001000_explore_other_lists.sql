-- Let My Lists be viewed cross-account the same way restaurants already
-- are: owner always, plus anyone if the account is public, plus accepted
-- followers if it's private. Mirrors the existing
-- "Users can view restaurants of public profiles" /
-- "Users can view restaurants of people they follow" policies exactly.

CREATE POLICY "Users can view custom lists of public profiles"
  ON public.custom_lists FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = custom_lists.user_id AND p.is_private = false));

CREATE POLICY "Users can view custom lists of people they follow"
  ON public.custom_lists FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.follows f
    WHERE f.follower_id = auth.uid() AND f.following_id = custom_lists.user_id AND f.status = 'accepted'
  ));

CREATE POLICY "Users can view custom list items of public profiles"
  ON public.custom_list_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = custom_list_items.user_id AND p.is_private = false));

CREATE POLICY "Users can view custom list items of people they follow"
  ON public.custom_list_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.follows f
    WHERE f.follower_id = auth.uid() AND f.following_id = custom_list_items.user_id AND f.status = 'accepted'
  ));

CREATE POLICY "Users can view custom list types of public profiles"
  ON public.custom_list_types FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = custom_list_types.user_id AND p.is_private = false));

CREATE POLICY "Users can view custom list types of people they follow"
  ON public.custom_list_types FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.follows f
    WHERE f.follower_id = auth.uid() AND f.following_id = custom_list_types.user_id AND f.status = 'accepted'
  ));

CREATE POLICY "Users can view custom list item images of public profiles"
  ON public.custom_list_item_images FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = custom_list_item_images.user_id AND p.is_private = false));

CREATE POLICY "Users can view custom list item images of people they follow"
  ON public.custom_list_item_images FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.follows f
    WHERE f.follower_id = auth.uid() AND f.following_id = custom_list_item_images.user_id AND f.status = 'accepted'
  ));

-- Explore's "Other Lists" tab: one row per account's list (not flattened to
-- individual items - a list is the natural browsable unit here, same way a
-- restaurant place is for the existing "Restaurants" tab). Every list with
-- at least one item shows up regardless of privacy (matching the existing
-- "All Nearby" convention for restaurants), but a private account's
-- identifying info is nulled out - the frontend renders those as a plain,
-- non-clickable "Anonymous" card instead of linking through to a profile
-- and list page that RLS would block anyway.
CREATE OR REPLACE FUNCTION public.get_explore_lists(p_mode text DEFAULT 'all')
RETURNS TABLE (
  list_id uuid,
  list_name text,
  list_icon text,
  item_count integer,
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  is_anonymous boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.name,
    l.icon,
    COUNT(i.id)::integer,
    l.user_id,
    CASE WHEN p.is_private AND l.user_id <> auth.uid() THEN NULL ELSE p.username END,
    CASE WHEN p.is_private AND l.user_id <> auth.uid() THEN NULL ELSE p.display_name END,
    CASE WHEN p.is_private AND l.user_id <> auth.uid() THEN NULL ELSE p.avatar_url END,
    (p.is_private AND l.user_id <> auth.uid())
  FROM public.custom_lists l
  JOIN public.profiles p ON p.user_id = l.user_id
  JOIN public.custom_list_items i ON i.list_id = l.id
  WHERE (
      l.user_id = auth.uid()
      OR (
        p_mode = 'friends'
        AND EXISTS (
          SELECT 1 FROM public.follows f
          WHERE f.follower_id = auth.uid()
            AND f.following_id = l.user_id
            AND f.status = 'accepted'
        )
      )
      OR p_mode = 'all'
    )
  GROUP BY l.id, l.name, l.icon, l.user_id, p.is_private, p.username, p.display_name, p.avatar_url
  ORDER BY MAX(i.created_at) DESC;
$$;

REVOKE ALL ON FUNCTION public.get_explore_lists(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_explore_lists(text) TO authenticated;
