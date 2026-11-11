-- Photo records: only on your own place or list item.
--
-- restaurant_images and custom_list_item_images let any signed-in user
-- insert a photo record for ANY restaurant_id / item_id, as long as the
-- record's user_id was their own. The read policies then decided who sees a
-- record by its uploader, not by the place's owner. So user B could attach
-- photos (files in B's own storage folder) to user A's place, and they
-- appeared in A's place for A (if A follows B) and for anyone following both
-- A and B. A couldn't remove them: delete is uploader-only. Mutual followers
-- can read each other's place ids, so this needed no special access.
--
-- This migration:
--   1. restaurant_images INSERT: the place must belong to the uploader.
--   2. restaurant_images follower SELECT: a photo is shown to followers only
--      when its uploader owns the place. Hides any record already attached
--      to someone else's place, without deleting it.
--   3. custom_list_item_images INSERT: the list item must belong to the
--      uploader. (Reads are already item-owner-bound once
--      20261030120000_list_visibility_and_anonymous_discovery is applied; on
--      the current schema a foreign record shows only as an unavailable
--      photo, because the file is in the uploader's owner-only folder.)
--
-- Policy change only: no rows or files are touched, safe to re-run, and it
-- does not recreate any custom_list_item_images read policy that
-- 20261030120000 drops. Legitimate uploads are unaffected: the app only
-- attaches photos to the signed-in user's own place or item.
--
-- Read-only checks (run with full privileges, i.e. not as a signed-in user,
-- or RLS will undercount). Expected: 0 rows each.
--   SELECT ri.id, ri.restaurant_id, ri.user_id AS uploader, r.user_id AS place_owner, ri.created_at
--   FROM public.restaurant_images ri JOIN public.restaurants r ON r.id = ri.restaurant_id
--   WHERE r.user_id <> ri.user_id;
--   SELECT ci.id, ci.item_id, ci.user_id AS uploader, i.user_id AS item_owner, ci.created_at
--   FROM public.custom_list_item_images ci JOIN public.custom_list_items i ON i.id = ci.item_id
--   WHERE i.user_id <> ci.user_id;
-- Any rows found are hidden by step 2 (places) / 20261030120000 (lists) but
-- not removed; removing them is a separate, approved data decision.

DROP POLICY IF EXISTS "Users can insert their own images" ON public.restaurant_images;
CREATE POLICY "Users can insert their own images"
ON public.restaurant_images FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.restaurants r
    WHERE r.id = restaurant_images.restaurant_id
      AND r.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can view images from followed users" ON public.restaurant_images;
CREATE POLICY "Users can view images from followed users"
ON public.restaurant_images FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.follows f
    WHERE f.follower_id = auth.uid()
      AND f.following_id = restaurant_images.user_id
      AND f.status = 'accepted'
  )
  AND EXISTS (
    SELECT 1 FROM public.restaurants r
    WHERE r.id = restaurant_images.restaurant_id
      AND r.user_id = restaurant_images.user_id
  )
);

DROP POLICY IF EXISTS "Users can insert their own custom list item images" ON public.custom_list_item_images;
CREATE POLICY "Users can insert their own custom list item images"
ON public.custom_list_item_images FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.custom_list_items i
    WHERE i.id = custom_list_item_images.item_id
      AND i.user_id = auth.uid()
  )
);
