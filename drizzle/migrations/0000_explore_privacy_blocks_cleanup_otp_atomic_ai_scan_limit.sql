-- ===== 20261004120000_explore_privacy_and_blocks.sql =====
-- Explore: respect blocks and private profiles inside the SECURITY DEFINER
-- discovery functions.
--
-- These three functions run as their owner, so the RLS on restaurants /
-- custom_lists (including the restrictive "blocked users cannot view ..."
-- policies) does not apply inside them. Each one therefore has to apply
-- the same rules itself:
--
--   * Blocks: rows owned by someone the viewer has blocked, or who has
--     blocked the viewer, are left out entirely - in aggregates too.
--   * Private profiles: a private user's identity, user id and written
--     notes are only returned to themselves and to accepted followers.
--     Previously the name was hidden but the user id (enough to open the
--     profile) and the notes were still returned to everyone.
--   * Private users' lists are no longer listed at all for people who
--     can't open them; the list name itself can be personal.
--
-- Signatures and return columns are unchanged, so existing app builds
-- keep working. For anonymous comment rows user_id is now NULL.

CREATE OR REPLACE FUNCTION public.get_explore_places(p_mode text DEFAULT 'all')
RETURNS TABLE (
  place_id text,
  name text,
  address text,
  latitude double precision,
  longitude double precision,
  category text,
  price_level integer,
  avg_rating double precision,
  rating_count integer,
  contributor_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(
      NULLIF(btrim(r.place_id), ''),
      'nm:' || md5(lower(btrim(r.name)) || '|' || lower(btrim(COALESCE(r.address, ''))))
    ) AS place_id,
    (array_agg(r.name ORDER BY r.created_at DESC))[1],
    (array_agg(r.address ORDER BY r.created_at DESC))[1],
    (array_agg(r.latitude ORDER BY r.created_at DESC))[1],
    (array_agg(r.longitude ORDER BY r.created_at DESC))[1],
    (array_agg(r.category ORDER BY r.created_at DESC) FILTER (WHERE r.category IS NOT NULL))[1],
    (array_agg(r.price_level ORDER BY r.created_at DESC) FILTER (WHERE r.price_level IS NOT NULL))[1],
    (AVG(r.rating) FILTER (WHERE r.rating IS NOT NULL))::double precision,
    (COUNT(r.rating) FILTER (WHERE r.rating IS NOT NULL))::integer,
    (COUNT(DISTINCT r.user_id))::integer
  FROM public.restaurants r
  JOIN public.profiles p ON p.user_id = r.user_id
  WHERE auth.uid() IS NOT NULL
    AND r.status = 'went_to'
    AND r.address IS NOT NULL
    AND btrim(r.address) <> ''
    AND NOT public.is_blocked_pair(auth.uid(), r.user_id)
    AND (
      r.user_id = auth.uid()
      OR (
        p_mode = 'friends'
        AND EXISTS (
          SELECT 1 FROM public.follows f
          WHERE f.follower_id = auth.uid()
            AND f.following_id = r.user_id
            AND f.status = 'accepted'
        )
      )
      OR p_mode = 'all'
    )
  GROUP BY 1;
$$;

REVOKE ALL ON FUNCTION public.get_explore_places(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_explore_places(text) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_place_comments(p_place_id text, p_mode text DEFAULT 'all')
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  avatar_emoji text,
  avatar_color text,
  rating integer,
  notes text,
  created_at timestamptz,
  is_anonymous boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE WHEN v.can_see THEN r.user_id END,
    CASE WHEN v.can_see THEN p.username END,
    CASE WHEN v.can_see THEN p.display_name END,
    CASE WHEN v.can_see THEN p.avatar_emoji END,
    CASE WHEN v.can_see THEN p.avatar_color END,
    r.rating,
    CASE WHEN v.can_see THEN r.notes END,
    r.created_at,
    NOT v.can_see AS is_anonymous
  FROM public.restaurants r
  JOIN public.profiles p ON p.user_id = r.user_id
  CROSS JOIN LATERAL (
    SELECT (
      r.user_id = auth.uid()
      OR NOT COALESCE(p.is_private, false)
      OR EXISTS (
        SELECT 1 FROM public.follows f
        WHERE f.follower_id = auth.uid()
          AND f.following_id = r.user_id
          AND f.status = 'accepted'
      )
    ) AS can_see
  ) v
  WHERE auth.uid() IS NOT NULL
    AND r.status = 'went_to'
    AND r.address IS NOT NULL
    AND btrim(r.address) <> ''
    AND COALESCE(
      NULLIF(btrim(r.place_id), ''),
      'nm:' || md5(lower(btrim(r.name)) || '|' || lower(btrim(COALESCE(r.address, ''))))
    ) = p_place_id
    AND NOT public.is_blocked_pair(auth.uid(), r.user_id)
    AND (
      r.user_id = auth.uid()
      OR (
        p_mode = 'friends'
        AND EXISTS (
          SELECT 1 FROM public.follows f
          WHERE f.follower_id = auth.uid()
            AND f.following_id = r.user_id
            AND f.status = 'accepted'
        )
      )
      OR p_mode = 'all'
    )
  ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_place_comments(text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_place_comments(text, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_explore_lists(p_mode text DEFAULT 'all')
RETURNS TABLE (
  list_id uuid,
  list_name text,
  list_icon text,
  item_count integer,
  user_id uuid,
  username text,
  display_name text,
  avatar_emoji text,
  avatar_color text,
  is_anonymous boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.name,
    l.icon,
    COUNT(i.id)::integer,
    l.user_id,
    p.username,
    p.display_name,
    p.avatar_emoji,
    p.avatar_color,
    false
  FROM public.custom_lists l
  JOIN public.profiles p ON p.user_id = l.user_id
  JOIN public.custom_list_items i ON i.list_id = l.id
  WHERE auth.uid() IS NOT NULL
    AND NOT public.is_blocked_pair(auth.uid(), l.user_id)
    AND (
      l.user_id = auth.uid()
      OR NOT COALESCE(p.is_private, false)
      OR EXISTS (
        SELECT 1 FROM public.follows f
        WHERE f.follower_id = auth.uid()
          AND f.following_id = l.user_id
          AND f.status = 'accepted'
      )
    )
    AND (
      l.user_id = auth.uid()
      OR (
        p_mode = 'friends'
        AND EXISTS (
          SELECT 1 FROM public.follows f
          WHERE f.follower_id = auth.uid()
            AND f.following_id = l.user_id
            AND f.status = 'accepted'
        )
      )
      OR p_mode = 'all'
    )
  GROUP BY l.id, l.name, l.icon, l.user_id, p.username, p.display_name, p.avatar_emoji, p.avatar_color
  ORDER BY MAX(i.created_at) DESC;
$$;

REVOKE ALL ON FUNCTION public.get_explore_lists(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_explore_lists(text) TO authenticated;

-- ===== 20261004121000_account_deletion_cleanup_log.sql =====
-- Durable record of anything account deletion couldn't finish.
--
-- delete-account removes the auth user first (which cascades through
-- almost every table), then cleans up what isn't covered by a cascade:
-- rows with no foreign key back to auth.users, and image files in
-- storage. If any of that follow-up work fails, the account itself is
-- already gone, so the user can't simply retry. Each failed step is
-- written here instead, so it can be finished by hand or by a later job
-- rather than silently leaving data behind.
--
-- No client access at all: RLS is on with no policies, so only the
-- service role (edge functions) can read or write it.

CREATE TABLE IF NOT EXISTS public.account_deletion_cleanup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_user_id UUID NOT NULL,
  step TEXT NOT NULL,
  detail TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_cleanup_open
  ON public.account_deletion_cleanup (created_at)
  WHERE resolved_at IS NULL;

ALTER TABLE public.account_deletion_cleanup ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.account_deletion_cleanup FROM anon, authenticated;

-- ===== 20261004122000_otp_atomic_operations.sql =====
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

-- ===== 20261004123000_ai_scan_daily_limit.sql =====
-- Per-user daily limit for AI photo scanning (parse-recipe-image, and the
-- planned "Scan anything").
--
-- Each scan is a paid AI request. Until now the function accepted any
-- caller holding the app's public key, with no cap, so anyone could run
-- up the AI bill. The function now requires a signed-in user and calls
-- ai_scan_try_consume first; this table holds one counter per user per
-- UTC day.
--
-- Service role only: RLS is on with no policies, and the function is not
-- executable by app users directly.

CREATE TABLE IF NOT EXISTS public.ai_scan_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  scans INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

ALTER TABLE public.ai_scan_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_scan_usage FROM anon, authenticated;

-- Atomically counts one scan for today if the user is under p_daily_limit.
-- Returns true if the scan may go ahead. A single INSERT ... ON CONFLICT
-- with a guarded UPDATE, so simultaneous scans can't both squeeze past
-- the limit.
CREATE OR REPLACE FUNCTION public.ai_scan_try_consume(p_user_id UUID, p_daily_limit INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH upsert AS (
    INSERT INTO public.ai_scan_usage AS u (user_id, day, scans)
    VALUES (p_user_id, (now() AT TIME ZONE 'utc')::date, 1)
    ON CONFLICT (user_id, day) DO UPDATE
      SET scans = u.scans + 1
      WHERE u.scans < p_daily_limit
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM upsert);
$$;

REVOKE ALL ON FUNCTION public.ai_scan_try_consume(UUID, INTEGER) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_scan_try_consume(UUID, INTEGER) TO service_role;