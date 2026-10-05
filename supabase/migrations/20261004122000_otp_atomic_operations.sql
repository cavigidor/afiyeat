-- Atomic sign-in-code operations for send-otp / verify-otp /
-- create-account / reset-password.
--
-- Before this, each edge function read the rate-limit or code row, made a
-- decision in JavaScript, then wrote back. Requests arriving at the same
-- moment could all read the same state, so:
--   * several "send code" requests could slip past the 3-per-15-minutes
--     limit, and could leave two live codes for one email;
--   * several wrong guesses could each be counted as the first attempt,
--     getting around the 5-attempt lockout;
--   * the same correct code could be used twice (e.g. two password
--     resets) before either request deleted it.
--
-- These functions do the read-decide-write in one transaction with a row
-- or advisory lock, so concurrent requests are processed one at a time.
-- They are callable only by the service role (edge functions).
--
-- Emails are expected already normalised (trimmed, lower-case) by the
-- caller.

-- Issue a new code for an email, enforcing the per-email request limit.
-- Replaces any existing code for that email, under the same lock as the
-- rate-limit check, so there is only ever one live code per email.
CREATE OR REPLACE FUNCTION public.otp_issue_code(
  p_email TEXT,
  p_code TEXT,
  p_max_requests INTEGER,
  p_window_minutes INTEGER,
  p_ttl_minutes INTEGER
)
RETURNS TABLE (allowed BOOLEAN, retry_after_minutes INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit RECORD;
BEGIN
  -- Serialise everything for this one email.
  PERFORM pg_advisory_xact_lock(hashtext('otp:' || p_email));

  SELECT id, request_count, window_start
    INTO v_limit
    FROM public.otp_rate_limits
   WHERE email = p_email
     AND window_start >= now() - make_interval(mins => p_window_minutes)
   ORDER BY window_start DESC
   LIMIT 1;

  IF FOUND THEN
    IF v_limit.request_count >= p_max_requests THEN
      RETURN QUERY SELECT
        false,
        GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
          v_limit.window_start + make_interval(mins => p_window_minutes) - now()
        )) / 60)::INTEGER);
      RETURN;
    END IF;
    UPDATE public.otp_rate_limits
       SET request_count = request_count + 1
     WHERE id = v_limit.id;
  ELSE
    INSERT INTO public.otp_rate_limits (email, request_count, window_start)
    VALUES (p_email, 1, now());
  END IF;

  DELETE FROM public.email_otp WHERE email = p_email;
  INSERT INTO public.email_otp (email, code, expires_at, verification_attempts, locked_until, verified)
  VALUES (p_email, p_code, now() + make_interval(mins => p_ttl_minutes), 0, NULL, false);

  RETURN QUERY SELECT true, 0;
END;
$$;

-- Check a code. Locks the code row, so attempts are counted exactly and a
-- correct code can be used only once.
--
-- p_consume = true  -> on success the code is deleted (create-account,
--                      reset-password: the code is spent).
-- p_consume = false -> on success the code is marked verified (verify-otp,
--                      a check without an action).
--
-- status is one of: ok, not_found, locked, expired, invalid, locked_now.
CREATE OR REPLACE FUNCTION public.otp_check_code(
  p_email TEXT,
  p_code TEXT,
  p_consume BOOLEAN,
  p_max_attempts INTEGER,
  p_lockout_minutes INTEGER
)
RETURNS TABLE (status TEXT, remaining_attempts INTEGER, retry_after_minutes INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_otp RECORD;
  v_attempts INTEGER;
BEGIN
  SELECT id, code, expires_at, verification_attempts, locked_until
    INTO v_otp
    FROM public.email_otp
   WHERE email = p_email
     AND verified = false
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, 0, 0;
    RETURN;
  END IF;

  IF v_otp.locked_until IS NOT NULL AND v_otp.locked_until > now() THEN
    RETURN QUERY SELECT
      'locked'::TEXT,
      0,
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_otp.locked_until - now())) / 60)::INTEGER);
    RETURN;
  END IF;

  IF v_otp.expires_at < now() THEN
    DELETE FROM public.email_otp WHERE id = v_otp.id;
    RETURN QUERY SELECT 'expired'::TEXT, 0, 0;
    RETURN;
  END IF;

  IF v_otp.code IS DISTINCT FROM p_code THEN
    v_attempts := COALESCE(v_otp.verification_attempts, 0) + 1;
    IF v_attempts >= p_max_attempts THEN
      UPDATE public.email_otp
         SET verification_attempts = v_attempts,
             locked_until = now() + make_interval(mins => p_lockout_minutes)
       WHERE id = v_otp.id;
      RETURN QUERY SELECT 'locked_now'::TEXT, 0, p_lockout_minutes;
      RETURN;
    END IF;
    UPDATE public.email_otp
       SET verification_attempts = v_attempts
     WHERE id = v_otp.id;
    RETURN QUERY SELECT 'invalid'::TEXT, p_max_attempts - v_attempts, 0;
    RETURN;
  END IF;

  IF p_consume THEN
    DELETE FROM public.email_otp WHERE id = v_otp.id;
  ELSE
    UPDATE public.email_otp SET verified = true WHERE id = v_otp.id;
  END IF;

  RETURN QUERY SELECT 'ok'::TEXT, 0, 0;
END;
$$;

-- Look up an account id by email for password reset. Replaces paging
-- through every user with listUsers(), which stops working past 20,000
-- accounts and gets slower with every signup.
CREATE OR REPLACE FUNCTION public.auth_user_id_by_email(p_email TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(btrim(p_email)) LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.otp_issue_code(TEXT, TEXT, INTEGER, INTEGER, INTEGER) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.otp_check_code(TEXT, TEXT, BOOLEAN, INTEGER, INTEGER) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.auth_user_id_by_email(TEXT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.otp_issue_code(TEXT, TEXT, INTEGER, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.otp_check_code(TEXT, TEXT, BOOLEAN, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.auth_user_id_by_email(TEXT) TO service_role;
