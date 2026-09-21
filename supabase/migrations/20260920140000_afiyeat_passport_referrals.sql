-- Afiyeat Passport: referral codes, attribution, and qualification.
--
-- Design constraints that shaped this:
--
-- 1. A referral must not be creditable from the client. Every transition
--    below happens in SECURITY DEFINER functions or triggers; the client
--    can read its own referral rows and nothing else.
-- 2. A click is not a referral, and neither is an empty signup. Credit is
--    earned when the invited person actually starts using Afiyeat, which
--    is defined here in terms of the real data model.
-- 3. Stamps are status, not currency. There is no balance to spend, no
--    transfer, and nothing purchasable - so there is no incentive to farm
--    them beyond vanity, and no consumer-protection surface.

-- ---------------------------------------------------------------------
-- Referral codes
-- ---------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

-- Codes are random, not derived from the username or the user id. A code
-- built from a database id leaks it; one built from a username changes
-- when the username does and quietly breaks every link already shared.
-- Ambiguous glyphs (0/O, 1/I/L) are excluded so a code read aloud or
-- typed from a screenshot resolves to exactly one string.
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate TEXT;
  i INT;
BEGIN
  LOOP
    candidate := '';
    FOR i IN 1..7 LOOP
      candidate := candidate || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
    END LOOP;
    -- 31^7 is ~27 billion, so collisions are vanishingly rare, but the
    -- unique index is the actual guarantee - this just retries.
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;

-- Backfill existing users so every account has a shareable code.
UPDATE public.profiles
SET referral_code = public.generate_referral_code()
WHERE referral_code IS NULL;

-- And assign one to every new profile.
CREATE OR REPLACE FUNCTION public.assign_referral_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := public.generate_referral_code();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_referral_code_trigger ON public.profiles;
CREATE TRIGGER assign_referral_code_trigger
BEFORE INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.assign_referral_code();

-- ---------------------------------------------------------------------
-- Referrals
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  referrer_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  referral_code TEXT NOT NULL,

  -- Where the link was tapped, and what was being shared. This is what
  -- lets us answer "do recipes or restaurants bring better users?" later
  -- without retrofitting instrumentation.
  source TEXT CHECK (source IS NULL OR source IN (
    'invite_link', 'restaurant', 'custom_list', 'recipe', 'profile', 'shared_list', 'other'
  )),
  shared_content_type TEXT,
  shared_content_id UUID,

  status TEXT NOT NULL DEFAULT 'signed_up' CHECK (status IN (
    'clicked', 'signed_up', 'qualified', 'rewarded', 'rejected'
  )),

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  signup_at   TIMESTAMPTZ,
  qualified_at TIMESTAMPTZ,
  rewarded_at TIMESTAMPTZ,
  rejected_reason TEXT,

  -- One referrer per referred person, forever. The partial unique index
  -- allows many 'clicked' rows (anonymous, no referred user yet) while
  -- guaranteeing that once someone signs up they are attributed exactly
  -- once - so a second invite link can't re-credit an existing user.
  CONSTRAINT referrals_no_self_referral CHECK (
    referred_user_id IS NULL OR referred_user_id <> referrer_user_id
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_one_referrer_per_user
  ON public.referrals (referred_user_id)
  WHERE referred_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_user_id, status);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Both sides can see the relationship they're part of. Nobody can write:
-- every insert and transition happens in the SECURITY DEFINER functions
-- below, which is what stops the client from minting its own referrals.
CREATE POLICY "Users can view referrals they are part of"
  ON public.referrals FOR SELECT
  USING (auth.uid() = referrer_user_id OR auth.uid() = referred_user_id);

-- ---------------------------------------------------------------------
-- Passport stamps
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.passport_stamps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('welcome', 'referral')),
  -- Set for referral stamps; the unique index on it is what makes
  -- awarding idempotent, so replaying qualification can never double-pay.
  referral_id UUID REFERENCES public.referrals(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_passport_stamps_one_per_referral
  ON public.passport_stamps (referral_id)
  WHERE referral_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_passport_stamps_one_welcome
  ON public.passport_stamps (user_id)
  WHERE kind = 'welcome';

CREATE INDEX IF NOT EXISTS idx_passport_stamps_user ON public.passport_stamps (user_id);

ALTER TABLE public.passport_stamps ENABLE ROW LEVEL SECURITY;

-- Stamps are public: the whole point is that they show on a profile.
CREATE POLICY "Anyone can view passport stamps"
  ON public.passport_stamps FOR SELECT
  USING (true);

-- ---------------------------------------------------------------------
-- Attribution at signup
-- ---------------------------------------------------------------------

-- Called by the client immediately after signup with whatever code was
-- captured from the invite link. SECURITY DEFINER because it writes to
-- referrals, which has no user INSERT policy.
--
-- Everything that could be abused is decided here, server-side:
--   - the code must resolve to a real account
--   - you cannot refer yourself
--   - you cannot be referred if you already have a referrer
--   - you cannot be referred if your account predates the invite
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

  -- Only genuinely new accounts can be attributed. Without this, an
  -- existing user could open any invite link and hand the sender a
  -- stamp - the single easiest way to farm the whole system.
  SELECT now() - created_at INTO v_account_age
  FROM auth.users WHERE id = v_user_id;

  IF v_account_age > INTERVAL '1 hour' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'account_not_new');
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

  -- Every new referred user gets their own welcome stamp, so the
  -- Passport isn't empty on day one.
  INSERT INTO public.passport_stamps (user_id, kind)
  VALUES (v_user_id, 'welcome')
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'referrer_id', v_referrer);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_referral(TEXT, TEXT, TEXT, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_referral(TEXT, TEXT, TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- Qualification
-- ---------------------------------------------------------------------

-- What counts as a real Afiyeat user, expressed against the actual data
-- model: three saved restaurants, or a first recipe, or a first list with
-- something actually in it (an empty list is an intention, not usage).
CREATE OR REPLACE FUNCTION public.has_activated(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM public.restaurants WHERE user_id = p_user_id) >= 3
    OR EXISTS (SELECT 1 FROM public.recipes WHERE user_id = p_user_id)
    OR EXISTS (
      SELECT 1 FROM public.custom_list_items WHERE user_id = p_user_id
    );
$$;

REVOKE EXECUTE ON FUNCTION public.has_activated(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.has_activated(UUID) TO authenticated;

-- Promotes a referral to qualified and awards the stamp. Idempotent: the
-- status guard plus the unique index on passport_stamps.referral_id mean
-- running this repeatedly - on a trigger, on a cron sweep, by hand -
-- awards exactly one stamp.
CREATE OR REPLACE FUNCTION public.try_qualify_referral(p_referred_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referral public.referrals%ROWTYPE;
BEGIN
  SELECT * INTO v_referral
  FROM public.referrals
  WHERE referred_user_id = p_referred_user_id
    AND status = 'signed_up'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- The 7-day window makes the metric mean "this invite produced someone
  -- who started using Afiyeat", not "someone who eventually did".
  IF v_referral.signup_at < now() - INTERVAL '7 days' THEN
    UPDATE public.referrals
    SET status = 'rejected', rejected_reason = 'activation_window_expired'
    WHERE id = v_referral.id;
    RETURN false;
  END IF;

  IF NOT public.has_activated(p_referred_user_id) THEN
    RETURN false;
  END IF;

  UPDATE public.referrals
  SET status = 'rewarded', qualified_at = now(), rewarded_at = now()
  WHERE id = v_referral.id;

  INSERT INTO public.passport_stamps (user_id, kind, referral_id)
  VALUES (v_referral.referrer_user_id, 'referral', v_referral.id)
  ON CONFLICT DO NOTHING;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.try_qualify_referral(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.try_qualify_referral(UUID) TO authenticated;

-- Qualification is checked when the referred user does something that
-- could constitute activation, rather than on a schedule - so the stamp
-- lands while they're still in the app and the referrer's notification is
-- about something that just happened.
CREATE OR REPLACE FUNCTION public.check_activation_on_content()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Cheap guard: almost every insert is by someone with no pending
  -- referral, and this keeps the common path to one indexed lookup.
  IF EXISTS (
    SELECT 1 FROM public.referrals
    WHERE referred_user_id = NEW.user_id AND status = 'signed_up'
  ) THEN
    PERFORM public.try_qualify_referral(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_activation_on_restaurant ON public.restaurants;
CREATE TRIGGER check_activation_on_restaurant
AFTER INSERT ON public.restaurants
FOR EACH ROW EXECUTE FUNCTION public.check_activation_on_content();

DROP TRIGGER IF EXISTS check_activation_on_recipe ON public.recipes;
CREATE TRIGGER check_activation_on_recipe
AFTER INSERT ON public.recipes
FOR EACH ROW EXECUTE FUNCTION public.check_activation_on_content();

DROP TRIGGER IF EXISTS check_activation_on_list_item ON public.custom_list_items;
CREATE TRIGGER check_activation_on_list_item
AFTER INSERT ON public.custom_list_items
FOR EACH ROW EXECUTE FUNCTION public.check_activation_on_content();

-- ---------------------------------------------------------------------
-- Passport summary
-- ---------------------------------------------------------------------

-- One round trip for the Passport screen. SECURITY DEFINER so it can
-- count the caller's own referrals without exposing the rows.
CREATE OR REPLACE FUNCTION public.get_passport_summary()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_code TEXT;
  v_qualified INT;
  v_pending INT;
  v_stamps INT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT referral_code INTO v_code FROM public.profiles WHERE user_id = v_user_id;

  SELECT
    count(*) FILTER (WHERE status IN ('qualified', 'rewarded')),
    count(*) FILTER (WHERE status = 'signed_up')
  INTO v_qualified, v_pending
  FROM public.referrals
  WHERE referrer_user_id = v_user_id;

  SELECT count(*) INTO v_stamps
  FROM public.passport_stamps WHERE user_id = v_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'referral_code', v_code,
    'qualified_count', COALESCE(v_qualified, 0),
    -- Signed up but not yet active. Shown as "getting started" rather
    -- than hidden, so the referrer can see the invite landed even though
    -- it hasn't earned a stamp yet.
    'pending_count', COALESCE(v_pending, 0),
    'stamp_count', COALESCE(v_stamps, 0)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_passport_summary() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_passport_summary() TO authenticated;
