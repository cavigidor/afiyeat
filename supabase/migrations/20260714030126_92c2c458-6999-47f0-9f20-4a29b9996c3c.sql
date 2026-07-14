-- notify_user() previously authenticated to the send-push edge function
-- using the service_role key, which grants full database admin access -
-- far more power than "allowed to trigger a push" needs. Switch to a
-- narrow, single-purpose secret instead: if it ever leaked, the only
-- thing it can be used for is sending push notifications, not reading or
-- writing arbitrary data.
--
-- Manual step required after this migration (never commit the value):
--   insert into private.secrets (name, value)
--   values ('internal_push_secret', '<the value you set as the
--            INTERNAL_PUSH_SECRET edge function secret>')
--   on conflict (name) do update set value = excluded.value;
--
--   delete from private.secrets where name = 'service_role_key';

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
  v_secret text;
BEGIN
  SELECT value INTO v_secret FROM private.secrets WHERE name = 'internal_push_secret';

  IF v_secret IS NULL THEN
    RAISE WARNING 'notify_user: private.secrets.internal_push_secret not set, skipping push to %', p_user_id;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://dmlkjpjubneqhbqoxlct.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', v_secret
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
