-- Removes everything social_sign_in_account_safety.sql added, and nothing else.
-- Refuses while any acceptance is recorded, because those rows are the only record that
-- those accounts accepted the Terms. To roll back anyway, first take a backup, then run
--   SELECT set_config('afiyeat.confirm_drop_terms_acceptances', 'backup-taken', false);
-- in the same session. The runner supplies the transaction (no BEGIN/COMMIT here).
DO $$
BEGIN
  IF to_regclass('public.terms_acceptances') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.terms_acceptances)
     AND coalesce(current_setting('afiyeat.confirm_drop_terms_acceptances', true), '') <> 'backup-taken' THEN
    RAISE EXCEPTION 'terms_acceptances has rows; take a backup and confirm before rolling back';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.social_account_discard_check(uuid);
DROP FUNCTION IF EXISTS public.social_sign_in_ready();
DROP FUNCTION IF EXISTS public.complete_account_setup(text, text, text, text);
DROP TABLE IF EXISTS public.terms_acceptances;
