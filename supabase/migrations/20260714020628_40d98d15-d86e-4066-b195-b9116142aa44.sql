-- Push notification infrastructure: a notify_user() helper that DB triggers
-- (and later, cron jobs) can call directly to send a push through the
-- send-push edge function, without any client-side involvement.

-- pg_net lets Postgres make outbound HTTP calls (fire-and-forget, queued).
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Private, API-inaccessible place to keep the service role key needed to
-- call our own edge functions from inside the database. Nothing in this
-- migration writes the actual secret value - see setup instructions
-- (run once, directly in the SQL editor, never committed to git):
--
--   insert into private.secrets (name, value)
--   values ('service_role_key', '<paste service role key from
--            Project Settings -> API -> service_role secret>')
--   on conflict (name) do update set value = excluded.value;
--
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.secrets (
  name text PRIMARY KEY,
  value text NOT NULL
);

-- Belt and suspenders: even though `private` isn't exposed over PostgREST,
-- explicitly revoke access from the roles the API uses.
REVOKE ALL ON private.secrets FROM anon, authenticated, public;
ALTER TABLE private.secrets ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies - anon/authenticated get zero rows even if
-- someone later grants table privileges by mistake. service_role bypasses
-- RLS entirely, which is the only role that should ever read this table.

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

-- Only triggers/cron jobs (running as the function owner) should call this -
-- never directly by clients.
REVOKE EXECUTE ON FUNCTION public.notify_user(uuid, text, text, jsonb) FROM anon, authenticated, public;

-- ---------------------------------------------------------------------
-- Follow requests: notify on new request/auto-follow, and on acceptance.
-- ---------------------------------------------------------------------
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

REVOKE EXECUTE ON FUNCTION public.notify_on_follow_insert() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.notify_on_follow_accepted() FROM anon, authenticated, public;

-- ---------------------------------------------------------------------
-- Shared list activity: notify the other member(s) when someone adds a
-- place to a list you share with them.
-- ---------------------------------------------------------------------
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

REVOKE EXECUTE ON FUNCTION public.notify_on_shared_list_item_insert() FROM anon, authenticated, public;
