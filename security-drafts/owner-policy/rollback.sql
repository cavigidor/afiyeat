-- ROLLBACK for fix.sql: restores the four policies exactly as main defines them (roles public, no separate
-- WITH CHECK on UPDATE). Verified by tests/owner-policy.test.mjs: after fix + rollback every policy on the
-- two tables is identical to main's. Restoring re-opens the gap; use only to undo a deployment that breaks
-- the app, and record why. If production's policies differ from main's (V1 shows it), write the rollback
-- from production's saved V1 output instead of using this file.
BEGIN;
DROP POLICY IF EXISTS "Users can insert their own list statuses" ON public.custom_list_statuses;
CREATE POLICY "Users can insert their own list statuses" ON public.custom_list_statuses FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own list statuses" ON public.custom_list_statuses;
CREATE POLICY "Users can update their own list statuses" ON public.custom_list_statuses FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert their own list types" ON public.custom_list_types;
CREATE POLICY "Users can insert their own list types" ON public.custom_list_types FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own list types" ON public.custom_list_types;
CREATE POLICY "Users can update their own list types" ON public.custom_list_types FOR UPDATE USING (auth.uid() = user_id);
COMMIT;
