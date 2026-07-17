-- Give the push notification copy a warmer, more branded voice (matching
-- "Afiyet Olsun") instead of generic system-notification phrasing. Same
-- triggers, same recipients, same data payloads - only the title/body text
-- changes.

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
      'Someone wants a seat at your table',
      follower_name || ' would love to follow your food journey.',
      jsonb_build_object('type', 'follow_request', 'follower_id', NEW.follower_id)
    );
  ELSE
    PERFORM public.notify_user(
      NEW.following_id,
      'New tablemate!',
      follower_name || ' just started following your list.',
      jsonb_build_object('type', 'new_follower', 'follower_id', NEW.follower_id)
    );
  END IF;

  RETURN NEW;
END;
$$;

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
      'Table''s open!',
      target_name || ' accepted your follow request - go see what they''re into.',
      jsonb_build_object('type', 'follow_accepted', 'following_id', NEW.following_id)
    );
  END IF;

  RETURN NEW;
END;
$$;

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
      adder_name || ' added ' || NEW.name || ' - afiyet olsun!',
      jsonb_build_object('type', 'shared_list_activity', 'list_id', NEW.list_id)
    );
  END IF;

  RETURN NEW;
END;
$$;

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
      'Your weekly table is set',
      'Food news, new recommendations, and friend activity are waiting for you on Afiyeat.',
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
      'Hungry for something new?',
      'It''s been a week - tell us where you''ve been eating lately.',
      jsonb_build_object('type', 'inactivity_reminder')
    );

    INSERT INTO public.engagement_reminders (user_id, last_sent_at)
    VALUES (r.user_id, now())
    ON CONFLICT (user_id) DO UPDATE SET last_sent_at = now();
  END LOOP;
END;
$$;
