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