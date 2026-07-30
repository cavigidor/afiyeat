CREATE OR REPLACE FUNCTION public.seed_default_folders(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.folders (user_id, name, color)
  VALUES
    (p_user_id, 'Lunch', '#FF9800'),
    (p_user_id, 'Dinner', '#3F51B5'),
    (p_user_id, 'Breakfast', '#FFC107'),
    (p_user_id, 'Brunch', '#FF7043'),
    (p_user_id, 'Bakery', '#C68958'),
    (p_user_id, 'Cafe', '#795548'),
    (p_user_id, 'Bar', '#9C27B0');
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, username, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'username', NEW.raw_user_meta_data ->> 'display_name');

  PERFORM public.seed_default_folders(NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.user_id
    FROM public.profiles p
    LEFT JOIN public.folders f ON f.user_id = p.user_id
    GROUP BY p.user_id
    HAVING COUNT(f.id) = 0
  LOOP
    PERFORM public.seed_default_folders(r.user_id);
  END LOOP;
END $$;