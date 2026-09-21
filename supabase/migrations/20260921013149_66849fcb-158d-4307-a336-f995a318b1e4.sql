CREATE OR REPLACE FUNCTION public.generate_referral_code()

RETURNS TEXT

LANGUAGE plpgsql

VOLATILE

SET search_path = public

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