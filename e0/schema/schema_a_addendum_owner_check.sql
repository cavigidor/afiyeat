-- =====================================================================
-- Afiyeat Lists V2 - SCHEMA A ADDENDUM - PROPOSAL FOR PM REVIEW
-- Status: NOT APPROVED. NOT APPLIED ANYWHERE. Do not paste into Lovable.
--
-- Separate from schema_a_proposal.sql on purpose: unlike Schema A, this
-- file REPLACES four existing write policies, so it deserves its own review.
--
-- Problem (in the repository's policies, stack tip included): INSERT and
-- UPDATE on custom_list_statuses and custom_list_types check only that
-- user_id is the caller. They do not check that the caller owns the list.
-- A signed-in user can therefore attach a status or category row to
-- someone else's list, and the owner's app then shows it.
-- PR #7 closed the same gap for custom_list_items; these two tables were
-- left as they were.
--
-- Whether production's live policies match the repository is unverified.
-- Read-only check to run first:
--   SELECT tablename, policyname, cmd, with_check FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('custom_list_statuses', 'custom_list_types')
--      AND cmd IN ('INSERT', 'UPDATE');
--
-- Effect on legitimate use: none. Every existing write path in the app
-- inserts statuses and categories into the signed-in user's own list.
-- =====================================================================

DROP POLICY IF EXISTS "Users can insert their own list statuses" ON public.custom_list_statuses;
CREATE POLICY "Users can insert their own list statuses"
  ON public.custom_list_statuses FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.custom_lists l WHERE l.id = list_id AND l.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update their own list statuses" ON public.custom_list_statuses;
CREATE POLICY "Users can update their own list statuses"
  ON public.custom_list_statuses FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.custom_lists l WHERE l.id = list_id AND l.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can insert their own list types" ON public.custom_list_types;
CREATE POLICY "Users can insert their own list types"
  ON public.custom_list_types FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.custom_lists l WHERE l.id = list_id AND l.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update their own list types" ON public.custom_list_types;
CREATE POLICY "Users can update their own list types"
  ON public.custom_list_types FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.custom_lists l WHERE l.id = list_id AND l.user_id = auth.uid())
  );
