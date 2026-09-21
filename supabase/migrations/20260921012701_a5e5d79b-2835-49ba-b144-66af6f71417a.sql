ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

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
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;

UPDATE public.profiles
SET referral_code = public.generate_referral_code()
WHERE referral_code IS NULL;

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

CREATE TABLE IF NOT EXISTS public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  referral_code TEXT NOT NULL,
  source TEXT CHECK (source IS NULL OR source IN (
    'invite_link', 'restaurant', 'custom_list', 'recipe', 'profile', 'shared_list', 'other'
  )),
  shared_content_type TEXT,
  shared_content_id UUID,
  status TEXT NOT NULL DEFAULT 'signed_up' CHECK (status IN (
    'clicked', 'signed_up', 'qualified', 'rewarded', 'rejected'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signup_at TIMESTAMPTZ,
  qualified_at TIMESTAMPTZ,
  rewarded_at TIMESTAMPTZ,
  rejected_reason TEXT,
  CONSTRAINT referrals_no_self_referral CHECK (
    referred_user_id IS NULL OR referred_user_id <> referrer_user_id
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_one_referrer_per_user
  ON public.referrals (referred_user_id)
  WHERE referred_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_user_id, status);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view referrals they are part of"
  ON public.referrals FOR SELECT
  USING (auth.uid() = referrer_user_id OR auth.uid() = referred_user_id);

CREATE TABLE IF NOT EXISTS public.passport_stamps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('welcome', 'referral')),
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

CREATE POLICY "Anyone can view passport stamps"
  ON public.passport_stamps FOR SELECT
  USING (true);

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
  INSERT INTO public.passport_stamps (user_id, kind)
  VALUES (v_user_id, 'welcome')
  ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'referrer_id', v_referrer);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_referral(TEXT, TEXT, TEXT, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_referral(TEXT, TEXT, TEXT, UUID) TO authenticated;

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
    OR EXISTS (SELECT 1 FROM public.custom_list_items WHERE user_id = p_user_id);
$$;

REVOKE EXECUTE ON FUNCTION public.has_activated(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.has_activated(UUID) TO authenticated;

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

CREATE OR REPLACE FUNCTION public.check_activation_on_content()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
    'pending_count', COALESCE(v_pending, 0),
    'stamp_count', COALESCE(v_stamps, 0)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_passport_summary() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_passport_summary() TO authenticated;