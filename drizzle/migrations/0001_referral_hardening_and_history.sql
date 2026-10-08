-- Referral hardening, plus the data behind the Passport history list and
-- the "you were invited by" welcome.
--
-- THE LOOPHOLE THIS CLOSES
-- claim_referral only credits brand-new accounts, one referrer per
-- account. But "account" was the only identity it knew about, so deleting
-- an account and signing up again produced a fresh, eligible account:
-- sign up through a friend's link, save three places, delete, repeat -
-- one stamp per loop, with nothing on the server able to tell.
--
-- The fix remembers a fingerprint of every email address that has ever
-- been referred, and refuses to credit the same address twice. The
-- fingerprint is a salted SHA-256 hash: it can't be turned back into the
-- address, and because the salt lives server-side, it can't be checked
-- against a list of known addresses either. It deliberately outlives
-- account deletion - that is the whole point - which makes it fraud-
-- prevention data and should be described as such in the privacy policy.

-- ---------------------------------------------------------------------
-- Salt, kept out of reach of the API
-- ---------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.secrets (
  name text PRIMARY KEY,
  value text NOT NULL
);

-- Two random UUIDs back to back: ~244 bits of randomness using only
-- built-in functions, so no extension needs enabling. Generated once;
-- re-running this migration never changes it (which would orphan every
-- stored hash).
INSERT INTO private.secrets (name, value)
VALUES (
  'referral_email_pepper',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS private.referred_email_hashes (
  email_hash text PRIMARY KEY,
  first_referred_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON private.referred_email_hashes FROM public, anon, authenticated;

-- Normalises before hashing so trivial variants of one inbox count as one:
-- case, "+tags" (me+1@, me+2@ all reach me@), and for Gmail the dots it
-- ignores (j.ane@ and jane@ are the same inbox).
CREATE OR REPLACE FUNCTION private.normalized_email_hash(p_email text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_local text;
  v_domain text;
  v_pepper text;
BEGIN
  IF p_email IS NULL OR position('@' in p_email) = 0 THEN
    RETURN NULL;
  END IF;

  v_local := lower(split_part(trim(p_email), '@', 1));
  v_domain := lower(split_part(trim(p_email), '@', 2));
  v_local := split_part(v_local, '+', 1);

  IF v_domain IN ('gmail.com', 'googlemail.com') THEN
    v_local := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  END IF;

  SELECT value INTO v_pepper FROM private.secrets WHERE name = 'referral_email_pepper';

  RETURN encode(
    sha256(convert_to(coalesce(v_pepper, '') || ':' || v_local || '@' || v_domain, 'UTF8')),
    'hex'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION private.normalized_email_hash(text) FROM public, anon, authenticated;

-- Anyone already referred before this migration is recorded too.
INSERT INTO private.referred_email_hashes (email_hash)
SELECT private.normalized_email_hash(u.email)
FROM public.referrals r
JOIN auth.users u ON u.id = r.referred_user_id
WHERE r.referred_user_id IS NOT NULL
  AND u.email IS NOT NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- claim_referral, now email-aware and returning who invited you
-- ---------------------------------------------------------------------

-- Same signature and return type as before, so existing callers keep
-- working. Two changes:
--   1. The email check, done as an INSERT ... ON CONFLICT so that two
--      simultaneous claims for one address can't both slip through a
--      check-then-insert gap.
--   2. On success it returns the inviter's public-facing name and avatar,
--      so the app can say who invited the new user. That's information
--      the new user is entitled to - they followed this person's link.
CREATE OR REPLACE FUNCTION public.claim_referral(
  p_code TEXT,
  p_source TEXT DEFAULT 'invite_link',
  p_content_type TEXT DEFAULT NULL,
  p_content_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_referrer UUID;
  v_account_age INTERVAL;
  v_email TEXT;
  v_hash TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT user_id INTO v_referrer
  FROM public.profiles
  WHERE referral_code = upper(trim(p_code));

  IF v_referrer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_code');
  END IF;

  IF v_referrer = v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'self_referral');
  END IF;

  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_user_id = v_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_referred');
  END IF;

  SELECT now() - created_at, email INTO v_account_age, v_email
  FROM auth.users WHERE id = v_user_id;

  IF v_account_age > INTERVAL '1 hour' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'account_not_new');
  END IF;

  -- The referrer's own address can't be used to sign up "a friend" either.
  IF private.normalized_email_hash(v_email) = (
    SELECT private.normalized_email_hash(u.email) FROM auth.users u WHERE u.id = v_referrer
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'self_referral');
  END IF;

  v_hash := private.normalized_email_hash(v_email);
  IF v_hash IS NOT NULL THEN
    INSERT INTO private.referred_email_hashes (email_hash)
    VALUES (v_hash)
    ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'email_already_referred');
    END IF;
  END IF;

  INSERT INTO public.referrals (
    referrer_user_id, referred_user_id, referral_code,
    source, shared_content_type, shared_content_id,
    status, signup_at
  ) VALUES (
    v_referrer, v_user_id, upper(trim(p_code)),
    p_source, p_content_type, p_content_id,
    'signed_up', now()
  );

  INSERT INTO public.passport_stamps (user_id, kind)
  VALUES (v_user_id, 'welcome')
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true,
    'referrer_id', v_referrer,
    'referrer', (
      SELECT jsonb_build_object(
        'user_id', p.user_id,
        'display_name', p.display_name,
        'username', p.username,
        'avatar_emoji', p.avatar_emoji,
        'avatar_color', p.avatar_color
      )
      FROM public.profiles p
      WHERE p.user_id = v_referrer
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_referral(TEXT, TEXT, TEXT, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_referral(TEXT, TEXT, TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- Passport history
-- ---------------------------------------------------------------------

-- The people you've invited, newest first, with how far each has got.
-- Only name and avatar - nothing else about them - and nothing at all for
-- anyone either side has blocked. Someone who later deleted their account
-- still appears (the invite happened), just without a name.
CREATE OR REPLACE FUNCTION public.get_referral_history()
RETURNS TABLE (
  status TEXT,
  signup_at TIMESTAMPTZ,
  qualified_at TIMESTAMPTZ,
  user_id UUID,
  display_name TEXT,
  username TEXT,
  avatar_emoji TEXT,
  avatar_color TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.status,
    r.signup_at,
    r.qualified_at,
    p.user_id,
    p.display_name,
    p.username,
    p.avatar_emoji,
    p.avatar_color
  FROM public.referrals r
  LEFT JOIN public.profiles p
    ON p.user_id = r.referred_user_id
   AND NOT public.is_blocked_pair(auth.uid(), r.referred_user_id)
  WHERE r.referrer_user_id = auth.uid()
    AND r.status <> 'clicked'
  ORDER BY r.signup_at DESC NULLS LAST
  LIMIT 100;
$$;

REVOKE EXECUTE ON FUNCTION public.get_referral_history() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_referral_history() TO authenticated;