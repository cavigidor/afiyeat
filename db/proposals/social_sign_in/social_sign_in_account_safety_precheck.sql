-- Read-only. Run BEFORE social_sign_in_account_safety.sql. Every row must say ok = true.
-- Changes nothing.
SELECT 'terms_acceptances does not exist yet' AS check, to_regclass('public.terms_acceptances') IS NULL AS ok
UNION ALL
SELECT 'complete_account_setup does not exist yet', NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'complete_account_setup')
UNION ALL
SELECT 'social_sign_in_ready does not exist yet', NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'social_sign_in_ready')
UNION ALL
SELECT 'social_account_discard_check does not exist yet', NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'social_account_discard_check')
UNION ALL
SELECT 'profiles has user_id, username, display_name, bio', (
  SELECT count(*) = 4 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles'
     AND column_name IN ('user_id', 'username', 'display_name', 'bio'))
UNION ALL
SELECT 'profiles.username is unique', EXISTS (
  SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
   WHERE i.indrelid = 'public.profiles'::regclass AND i.indisunique AND a.attname = 'username'
     AND array_length(i.indkey::int2[], 1) = 1)
UNION ALL
SELECT 'folders has user_id, name, color', (
  SELECT count(*) = 3 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'folders' AND column_name IN ('user_id', 'name', 'color'))
UNION ALL
SELECT 'auth.identities has user_id and provider', (
  SELECT count(*) = 2 FROM information_schema.columns
   WHERE table_schema = 'auth' AND table_name = 'identities' AND column_name IN ('user_id', 'provider'))
UNION ALL
SELECT 'storage.objects has owner and name', (
  SELECT count(*) = 2 FROM information_schema.columns
   WHERE table_schema = 'storage' AND table_name = 'objects' AND column_name IN ('owner', 'name'))
UNION ALL
SELECT 'device_tokens exists (excluded from the discard check)', to_regclass('public.device_tokens') IS NOT NULL;
