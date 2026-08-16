CREATE OR REPLACE FUNCTION public.notify_on_friend_visited_your_to_go_place()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  visitor_name text;
  r record;
BEGIN
  IF NEW.place_id IS NULL OR NEW.status <> 'went_to' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status = 'went_to'
     AND OLD.rating IS NOT DISTINCT FROM NEW.rating THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(display_name, username, 'Someone') INTO visitor_name
  FROM public.profiles WHERE user_id = NEW.user_id;

  FOR r IN
    SELECT f.follower_id, mine.id AS restaurant_id, mine.name
    FROM public.follows f
    JOIN public.restaurants mine
      ON mine.user_id = f.follower_id
     AND mine.place_id = NEW.place_id
     AND mine.status = 'to_go'
    WHERE f.following_id = NEW.user_id
      AND f.status = 'accepted'
  LOOP
    PERFORM public.notify_user(
      r.follower_id,
      'Someone beat you to it',
      visitor_name || ' just went to ' || r.name || ' - it''s on your To Go list.',
      jsonb_build_object(
        'type', 'friend_visited_your_to_go',
        'place_id', NEW.place_id,
        'restaurant_id', r.restaurant_id
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_on_friend_visited_your_to_go_place_trigger ON public.restaurants;

CREATE TRIGGER notify_on_friend_visited_your_to_go_place_trigger
AFTER INSERT OR UPDATE ON public.restaurants
FOR EACH ROW
EXECUTE FUNCTION public.notify_on_friend_visited_your_to_go_place();

REVOKE EXECUTE ON FUNCTION public.notify_on_friend_visited_your_to_go_place() FROM anon, authenticated, public;

CREATE OR REPLACE FUNCTION public.send_weekly_suggestions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  pick record;
BEGIN
  FOR r IN SELECT DISTINCT user_id FROM public.device_tokens LOOP
    SELECT rest.name, rest.place_id,
           COALESCE(p.display_name, p.username, 'A friend') AS adder_name
    INTO pick
    FROM public.restaurants rest
    JOIN public.follows f
      ON f.following_id = rest.user_id
     AND f.follower_id = r.user_id
     AND f.status = 'accepted'
    JOIN public.profiles p ON p.user_id = rest.user_id
    WHERE rest.status = 'went_to'
      AND rest.created_at > now() - interval '7 days'
      AND rest.rating IS NOT NULL
      AND (
        rest.place_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.restaurants mine
          WHERE mine.user_id = r.user_id AND mine.place_id = rest.place_id
        )
      )
    ORDER BY rest.rating DESC, rest.created_at DESC
    LIMIT 1;

    IF FOUND THEN
      PERFORM public.notify_user(
        r.user_id,
        'A table worth trying',
        pick.adder_name || ' loved ' || pick.name || ' - might be your next stop.',
        jsonb_build_object('type', 'personalized_suggestion', 'place_id', pick.place_id)
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_weekly_suggestions() FROM anon, authenticated, public;

SELECT cron.unschedule('weekly-suggestions') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-suggestions');

SELECT cron.schedule(
  'weekly-suggestions',
  '0 15 * * 1',
  $$ SELECT public.send_weekly_suggestions(); $$
);

CREATE OR REPLACE FUNCTION public.send_daily_prompt()
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
      'What''s on the table today?',
      'Log a place you visited today before you forget the details.',
      jsonb_build_object('type', 'daily_prompt')
    );
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_daily_prompt() FROM anon, authenticated, public;

SELECT cron.unschedule('daily-prompt') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-prompt');

SELECT cron.schedule(
  'daily-prompt',
  '0 23 * * *',
  $$ SELECT public.send_daily_prompt(); $$
);