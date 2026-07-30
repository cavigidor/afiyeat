DO $$
DECLARE
  r RECORD;
  target_id UUID;
BEGIN
  FOR r IN SELECT id, user_id FROM public.folders WHERE lower(name) = 'cafes' LOOP
    SELECT id INTO target_id FROM public.folders
      WHERE user_id = r.user_id AND lower(name) = 'cafe' AND id <> r.id LIMIT 1;
    IF target_id IS NULL THEN
      UPDATE public.folders SET name = 'Cafe' WHERE id = r.id;
    ELSE
      UPDATE public.restaurants SET folder_id = target_id WHERE folder_id = r.id;
      DELETE FROM public.folders WHERE id = r.id;
    END IF;
  END LOOP;

  FOR r IN SELECT id, user_id FROM public.folders WHERE lower(name) = 'bars' LOOP
    SELECT id INTO target_id FROM public.folders
      WHERE user_id = r.user_id AND lower(name) = 'bar' AND id <> r.id LIMIT 1;
    IF target_id IS NULL THEN
      UPDATE public.folders SET name = 'Bar' WHERE id = r.id;
    ELSE
      UPDATE public.restaurants SET folder_id = target_id WHERE folder_id = r.id;
      DELETE FROM public.folders WHERE id = r.id;
    END IF;
  END LOOP;

  FOR r IN SELECT id, user_id FROM public.folders WHERE lower(name) IN ('dessert', 'desserts') LOOP
    SELECT id INTO target_id FROM public.folders
      WHERE user_id = r.user_id AND lower(name) = 'bakery' LIMIT 1;
    IF target_id IS NULL THEN
      INSERT INTO public.folders (user_id, name, color)
        VALUES (r.user_id, 'Bakery', '#C68958')
        RETURNING id INTO target_id;
    END IF;
    UPDATE public.restaurants SET folder_id = target_id WHERE folder_id = r.id;
    DELETE FROM public.folders WHERE id = r.id;
  END LOOP;
END $$;