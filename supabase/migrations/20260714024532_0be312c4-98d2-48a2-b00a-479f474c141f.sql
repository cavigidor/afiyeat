-- ============================================================
-- Migration 20260713162528: device_tokens table
-- ============================================================
CREATE TABLE public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  platform text NOT NULL DEFAULT 'ios' CHECK (platform IN ('ios', 'android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX device_tokens_user_id_idx ON public.device_tokens(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_tokens TO authenticated;
GRANT ALL ON public.device_tokens TO service_role;

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own device tokens"
  ON public.device_tokens FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own device tokens"
  ON public.device_tokens FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own device tokens"
  ON public.device_tokens FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own device tokens"
  ON public.device_tokens FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_device_tokens_updated_at
  BEFORE UPDATE ON public.device_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Migration 20260714020628: notify_user + follow/shared-list triggers
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.secrets (
  name text PRIMARY KEY,
  value text NOT NULL
);

REVOKE ALL ON private.secrets FROM anon, authenticated, public;
ALTER TABLE private.secrets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.notify_user(
  p_user_id uuid,
  p_title text,
  p_body text,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service_key text;
BEGIN
  SELECT value INTO v_service_key FROM private.secrets WHERE name = 'service_role_key';

  IF v_service_key IS NULL THEN
    RAISE WARNING 'notify_user: private.secrets.service_role_key not set, skipping push to %', p_user_id;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://dmlkjpjubneqhbqoxlct.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object(
      'user_id', p_user_id,
      'title', p_title,
      'body', p_body,
      'data', p_data
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_user(uuid, text, text, jsonb) FROM anon, authenticated, public;

CREATE OR REPLACE FUNCTION public.notify_on_follow_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  follower_name text;
BEGIN
  SELECT COALESCE(display_name, username, 'Someone') INTO follower_name
  FROM public.profiles WHERE user_id = NEW.follower_id;

  IF NEW.status = 'pending' THEN
    PERFORM public.notify_user(
      NEW.following_id,
      'New follow request',
      follower_name || ' wants to follow you',
      jsonb_build_object('type', 'follow_request', 'follower_id', NEW.follower_id)
    );
  ELSE
    PERFORM public.notify_user(
      NEW.following_id,
      'New follower',
      follower_name || ' started following you',
      jsonb_build_object('type', 'new_follower', 'follower_id', NEW.follower_id)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_on_follow_insert_trigger ON public.follows;
CREATE TRIGGER notify_on_follow_insert_trigger
AFTER INSERT ON public.follows
FOR EACH ROW
EXECUTE FUNCTION public.notify_on_follow_insert();

CREATE OR REPLACE FUNCTION public.notify_on_follow_accepted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_name text;
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    SELECT COALESCE(display_name, username, 'Someone') INTO target_name
    FROM public.profiles WHERE user_id = NEW.following_id;

    PERFORM public.notify_user(
      NEW.follower_id,
      'Follow request accepted',
      target_name || ' accepted your follow request',
      jsonb_build_object('type', 'follow_accepted', 'following_id', NEW.following_id)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_on_follow_accepted_trigger ON public.follows;
CREATE TRIGGER notify_on_follow_accepted_trigger
AFTER UPDATE ON public.follows
FOR EACH ROW
EXECUTE FUNCTION public.notify_on_follow_accepted();

CREATE OR REPLACE FUNCTION public.notify_on_shared_list_item_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  adder_name text;
  list_name text;
  other_user_id uuid;
BEGIN
  SELECT COALESCE(display_name, username, 'Someone') INTO adder_name
  FROM public.profiles WHERE user_id = NEW.added_by;

  SELECT name, (CASE WHEN user_a = NEW.added_by THEN user_b ELSE user_a END)
  INTO list_name, other_user_id
  FROM public.shared_lists WHERE id = NEW.list_id;

  IF other_user_id IS NOT NULL THEN
    PERFORM public.notify_user(
      other_user_id,
      list_name,
      adder_name || ' added ' || NEW.name,
      jsonb_build_object('type', 'shared_list_activity', 'list_id', NEW.list_id)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_on_shared_list_item_insert_trigger ON public.shared_list_items;
CREATE TRIGGER notify_on_shared_list_item_insert_trigger
AFTER INSERT ON public.shared_list_items
FOR EACH ROW
EXECUTE FUNCTION public.notify_on_shared_list_item_insert();

REVOKE EXECUTE ON FUNCTION public.notify_on_follow_insert() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.notify_on_follow_accepted() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.notify_on_shared_list_item_insert() FROM anon, authenticated, public;

-- ============================================================
-- Migration 20260714020715: scheduled digest + inactivity reminders
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS public.engagement_reminders (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_sent_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.engagement_reminders TO service_role;
ALTER TABLE public.engagement_reminders ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.send_weekly_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT user_id FROM public.device_tokens LOOP
    PERFORM public.notify_user(
      r.user_id,
      'Your weekly Afiyeat digest',
      'New food news, recommendations, and friend activity are waiting for you.',
      jsonb_build_object('type', 'weekly_digest')
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_inactivity_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT dt.user_id
    FROM (SELECT DISTINCT user_id FROM public.device_tokens) dt
    LEFT JOIN (
      SELECT user_id, MAX(created_at) AS last_added
      FROM public.restaurants
      GROUP BY user_id
    ) ra ON ra.user_id = dt.user_id
    LEFT JOIN public.engagement_reminders er ON er.user_id = dt.user_id
    WHERE COALESCE(ra.last_added, '1970-01-01'::timestamptz) < now() - interval '7 days'
      AND (er.last_sent_at IS NULL OR er.last_sent_at < now() - interval '7 days')
  LOOP
    PERFORM public.notify_user(
      r.user_id,
      'Haven''t added a place in a while?',
      'Tap to log a new restaurant, bar, or recipe you tried recently.',
      jsonb_build_object('type', 'inactivity_reminder')
    );

    INSERT INTO public.engagement_reminders (user_id, last_sent_at)
    VALUES (r.user_id, now())
    ON CONFLICT (user_id) DO UPDATE SET last_sent_at = now();
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_weekly_digest() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.send_inactivity_reminders() FROM anon, authenticated, public;

SELECT cron.schedule(
  'weekly-digest',
  '0 16 * * 1',
  $$ SELECT public.send_weekly_digest(); $$
);

SELECT cron.schedule(
  'inactivity-reminders',
  '0 17 * * *',
  $$ SELECT public.send_inactivity_reminders(); $$
);