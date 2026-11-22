-- Social sign-in account safety (draft PR "backend/social-sign-in-account-safety").
-- NOT a migration: kept out of supabase/migrations so nothing applies it automatically.
-- Apply only with PM approval, through the plan in docs/social-sign-in/BACKEND_APPROVAL.md
-- (precheck -> this file -> postcheck). The runner supplies the transaction: there are
-- deliberately no BEGIN/COMMIT statements, and any error rolls the whole file back.
--
-- Adds, and changes nothing that exists:
--   1. public.terms_acceptances       - server-side record that a new Apple/Google account
--                                         accepted the Terms and Privacy Policy.
--   2. public.complete_account_setup  - saves username/display name AND records acceptance
--                                         in one transaction, with a server-set timestamp.
--   3. public.social_sign_in_ready    - tells the app this file is applied, so it only offers
--                                         Apple/Google sign-in once the backend is ready.
--   4. public.social_account_discard_check - lets delete-account refuse to "discard" any
--                                         account that has data, other sign-in methods or
--                                         relationships. Callable by service_role only.

-- 1. Acceptance record ----------------------------------------------------------------------
-- One row per account per Terms/Privacy version. Rows are written only by
-- complete_account_setup (SECURITY DEFINER) with auth.uid() and now(), so neither the
-- account nor the time can be chosen by the client. Accounts can read their own rows and
-- nothing else; no one but service_role can change or remove a row. Deleting the account
-- deletes its rows with it (ON DELETE CASCADE), like the rest of its data.
CREATE TABLE public.terms_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  terms_version text NOT NULL CHECK (terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  privacy_version text NOT NULL CHECK (privacy_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  method text NOT NULL CHECK (method IN ('account_setup')),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT terms_acceptances_once_per_version UNIQUE (user_id, terms_version, privacy_version)
);

COMMENT ON TABLE public.terms_acceptances IS
  'Server-side record that an account accepted the Terms of Service and Privacy Policy (versions are the "Last updated" dates). Written only by complete_account_setup().';

ALTER TABLE public.terms_acceptances ENABLE ROW LEVEL SECURITY;

-- New tables inherit broad default privileges; take them all back, then grant exactly
-- what's needed.
REVOKE ALL ON public.terms_acceptances FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.terms_acceptances TO authenticated;
GRANT ALL ON public.terms_acceptances TO service_role;

CREATE POLICY "Accounts read their own terms acceptances"
  ON public.terms_acceptances
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- 2. Finish account setup ----------------------------------------------------------------------
-- The versions the app must send are fixed here, so a client can't record acceptance of a
-- version that isn't current. When the Terms or Privacy Policy change, a reviewed SQL change
-- updates these two constants together with the app's TERMS_VERSION.
CREATE OR REPLACE FUNCTION public.complete_account_setup(
  p_username text,
  p_display_name text,
  p_terms_version text,
  p_privacy_version text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_terms_version   constant text := '2026-10-07';
  c_privacy_version constant text := '2026-10-07';
  v_uid      uuid := auth.uid();
  v_username text := btrim(coalesce(p_username, ''));
  v_display  text := nullif(btrim(coalesce(p_display_name, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_terms_version IS DISTINCT FROM c_terms_version
     OR p_privacy_version IS DISTINCT FROM c_privacy_version THEN
    RAISE EXCEPTION 'terms_version_mismatch' USING ERRCODE = '22023';
  END IF;
  -- Same limits as the email sign-up form and Profile.
  IF char_length(v_username) < 3 OR char_length(v_username) > 20 THEN
    RAISE EXCEPTION 'invalid_username' USING ERRCODE = '22023';
  END IF;
  IF v_display IS NOT NULL AND char_length(v_display) > 50 THEN
    RAISE EXCEPTION 'invalid_display_name' USING ERRCODE = '22023';
  END IF;

  -- A taken username raises unique_violation (23505) here, which undoes the whole call:
  -- no acceptance is recorded without a saved profile.
  UPDATE public.profiles
     SET username = v_username,
         display_name = coalesce(v_display, v_username)
   WHERE user_id = v_uid;
  IF NOT FOUND THEN
    INSERT INTO public.profiles (user_id, username, display_name)
    VALUES (v_uid, v_username, coalesce(v_display, v_username));
  END IF;

  INSERT INTO public.terms_acceptances (user_id, terms_version, privacy_version, method)
  VALUES (v_uid, c_terms_version, c_privacy_version, 'account_setup')
  ON CONFLICT ON CONSTRAINT terms_acceptances_once_per_version DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_account_setup(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_account_setup(text, text, text, text) TO authenticated;

-- 3. Readiness probe ---------------------------------------------------------------------------
-- The app shows Apple/Google buttons only when the provider is enabled AND this answers, so
-- turning a provider on before this file is applied can't strand new accounts at setup.
CREATE OR REPLACE FUNCTION public.social_sign_in_ready()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$ SELECT 'v1'::text $$;

REVOKE ALL ON FUNCTION public.social_sign_in_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.social_sign_in_ready() TO anon, authenticated;

-- 4. Discard safeguard -------------------------------------------------------------------------
-- delete-account's "discard_new_account" mode (the setup screen's "Already have an Afiyeat
-- account?") may only remove an account that was created by Apple/Google sign-in moments
-- ago and never used. Returns {"eligible": bool, "reasons": [...]}; any reason refuses.
--
-- Relationships and content are found generically: every public table with a foreign key
-- to auth.users is checked for rows that point at the account, so tables added later are
-- covered without editing this function. Only the rows sign-up itself creates are allowed:
-- the profile (with no username, display name or bio), the seven seeded default folders
-- unchanged, and device push tokens (not user content; deleted with the account anyway).
-- A few user columns have no foreign key and are listed explicitly.
CREATE OR REPLACE FUNCTION public.social_account_discard_check(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reasons   text[] := ARRAY[]::text[];
  v_user      record;
  v_found     boolean;
  v_count     integer;
  r           record;
BEGIN
  SELECT u.id, u.created_at, u.raw_app_meta_data INTO v_user
    FROM auth.users u WHERE u.id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'reasons', jsonb_build_array('no_such_user'));
  END IF;

  -- How the account was created and how it can sign in.
  IF coalesce(v_user.raw_app_meta_data ->> 'provider', '') NOT IN ('apple', 'google') THEN
    v_reasons := array_append(v_reasons, 'not_created_by_apple_or_google');
  END IF;
  IF v_user.created_at < now() - interval '7 days' THEN
    v_reasons := array_append(v_reasons, 'older_than_7_days');
  END IF;
  SELECT count(*) INTO v_count FROM auth.identities i WHERE i.user_id = p_user_id;
  IF v_count <> 1 THEN
    v_reasons := array_append(v_reasons, 'has_other_sign_in_methods');
  END IF;
  IF EXISTS (SELECT 1 FROM auth.identities i
              WHERE i.user_id = p_user_id AND i.provider NOT IN ('apple', 'google')) THEN
    v_reasons := array_append(v_reasons, 'has_email_or_other_identity');
  END IF;

  -- Finished setup or edited the profile.
  IF EXISTS (SELECT 1 FROM public.profiles p
              WHERE p.user_id = p_user_id
                AND (coalesce(btrim(p.username), '') <> ''
                     OR coalesce(btrim(p.display_name), '') <> ''
                     OR coalesce(btrim(p.bio), '') <> '')) THEN
    v_reasons := array_append(v_reasons, 'profile_has_details');
  END IF;
  IF EXISTS (SELECT 1 FROM public.terms_acceptances t WHERE t.user_id = p_user_id) THEN
    v_reasons := array_append(v_reasons, 'accepted_terms');
  END IF;

  -- Folders: only the unchanged starter set that sign-up seeds.
  IF EXISTS (
       SELECT 1 FROM public.folders f
        WHERE f.user_id = p_user_id
          AND (f.name, f.color) NOT IN (VALUES
                ('Lunch', '#FF9800'), ('Dinner', '#3F51B5'), ('Breakfast', '#FFC107'),
                ('Brunch', '#FF7043'), ('Bakery', '#C68958'), ('Cafe', '#795548'), ('Bar', '#9C27B0')))
     OR (SELECT count(*) FROM public.folders f WHERE f.user_id = p_user_id) > 7 THEN
    v_reasons := array_append(v_reasons, 'folders_changed');
  END IF;

  -- Every other table that references the account through a foreign key.
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       AND c.confrelid = 'auth.users'::regclass
       AND array_length(c.conkey, 1) = 1
       AND c.connamespace = 'public'::regnamespace
       AND c.conrelid NOT IN ('public.profiles'::regclass, 'public.folders'::regclass,
                              'public.device_tokens'::regclass, 'public.terms_acceptances'::regclass)
     ORDER BY 1, 2
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', r.tbl, r.col)
      INTO v_found USING p_user_id;
    IF v_found THEN
      v_reasons := array_append(v_reasons, format('has_rows:%s.%s', r.tbl, r.col));
    END IF;
  END LOOP;

  -- User columns without a foreign key (as listed in delete-account and the schema).
  FOR r IN
    SELECT * FROM (VALUES
      ('public.recipes', 'user_id'), ('public.cellar_items', 'user_id'),
      ('public.shared_lists', 'user_a'), ('public.shared_lists', 'user_b'),
      ('public.shared_list_items', 'added_by'), ('public.shared_list_item_comments', 'user_id'),
      ('public.moderation_actions', 'target_user_id'), ('public.moderation_hidden', 'owner_id')
    ) AS v(tbl, col)
  LOOP
    IF to_regclass(r.tbl) IS NOT NULL AND EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = to_regclass(r.tbl) AND a.attname = r.col AND NOT a.attisdropped) THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', to_regclass(r.tbl), r.col)
        INTO v_found USING p_user_id;
      IF v_found THEN
        v_reasons := array_append(v_reasons, format('has_rows:%s.%s', to_regclass(r.tbl), r.col));
      END IF;
    END IF;
  END LOOP;

  -- Uploaded files (photos), by owner or by the {userId}/ folder the app uses.
  IF EXISTS (SELECT 1 FROM storage.objects o
              WHERE o.owner = p_user_id
                 OR o.name LIKE p_user_id::text || '/%') THEN
    v_reasons := array_append(v_reasons, 'has_uploaded_files');
  END IF;

  RETURN jsonb_build_object('eligible', cardinality(v_reasons) = 0, 'reasons', to_jsonb(v_reasons));
END;
$$;

REVOKE ALL ON FUNCTION public.social_account_discard_check(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_account_discard_check(uuid) TO service_role;
