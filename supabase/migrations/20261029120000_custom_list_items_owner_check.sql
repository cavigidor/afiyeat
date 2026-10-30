-- Custom-list items may only be added to (or moved into) a list you own.
--
-- The original policies (20260814210336) checked only that the new row's
-- user_id was the caller's, not that list_id was one of the caller's
-- lists. So an API call could add an item - stamped with the caller's own
-- id - to somebody else's list. The app never offers that (Add Item and
-- each list's Add button only show your own lists); this makes the
-- database refuse it too, as shared_list_items already does with
-- is_shared_list_member.
--
-- Policy-only change: no table, column or row is touched, and every
-- legitimate write (adding to or editing items in your own lists) is
-- still allowed. Safe to re-run.

DROP POLICY IF EXISTS "Users can insert their own custom list items" ON public.custom_list_items;
CREATE POLICY "Users can insert their own custom list items"
  ON public.custom_list_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.custom_lists l
      WHERE l.id = custom_list_items.list_id
        AND l.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update their own custom list items" ON public.custom_list_items;
CREATE POLICY "Users can update their own custom list items"
  ON public.custom_list_items
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.custom_lists l
      WHERE l.id = custom_list_items.list_id
        AND l.user_id = auth.uid()
    )
  );
