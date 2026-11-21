-- =====================================================================
-- SECURITY DRAFT - list-ownership check on status and category writes
-- Status: PROPOSAL. NOT APPROVED. NOT APPLIED ANYWHERE. Not a migration: do not copy into
-- supabase/migrations/ and do not paste into Lovable until the PM authorizes a deployment.
--
-- Gap (in the repository, main and the integration stack alike): INSERT and UPDATE on
-- custom_list_statuses and custom_list_types check only user_id = auth.uid(). They do not check that
-- the caller owns the list, so a signed-in user can attach a status or category to someone else's list.
-- Production's live policies are UNVERIFIED (read-only check: owner-check-verification.sql V1, V6).
--
-- Replaces exactly four policies, by name, in one transaction. Changes nothing else:
-- SELECT and DELETE policies, other tables, data and grants are untouched (tested).
-- Precondition (checked below): each table has exactly these permissive INSERT/UPDATE policies; any other
-- permissive INSERT/UPDATE/ALL policy would keep the gap open (Postgres ORs permissive policies), so the
-- script stops instead of guessing.
-- =====================================================================
BEGIN;

DO $$
DECLARE extra text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname || ' (' || cmd || ')', ', ') INTO extra
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('custom_list_statuses', 'custom_list_types')
     AND permissive = 'PERMISSIVE' AND cmd IN ('INSERT', 'UPDATE', 'ALL')
     AND policyname NOT IN ('Users can insert their own list statuses', 'Users can update their own list statuses',
                            'Users can insert their own list types', 'Users can update their own list types');
  IF extra IS NOT NULL THEN
    RAISE EXCEPTION 'stopped: unexpected permissive write policies would keep the gap open: %', extra;
  END IF;
END $$;

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

COMMIT;
