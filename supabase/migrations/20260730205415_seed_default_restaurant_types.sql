-- Types/folders were entirely user-created with no starter set, so a brand
-- new account (or any existing account that never made one) shows "No
-- types yet" until the user manually taps "+ Create New Type" for each one.
-- Seed a standard starter set instead, matching the top of the app's
-- canonical type order (src/lib/typeOrder.ts): Lunch, Dinner, Breakfast,
-- Brunch, Bakery, Cafe, Bar. Users can still rename, delete, or add their
-- own on top - this only ever runs once per account, not "whenever empty",
-- so someone who deliberately deletes all their types later won't have
-- them silently reappear.

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

-- Extend new-signup handling to also seed default folders for the new
-- account, in addition to the existing profile row.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, username, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'username', NEW.raw_user_meta_data ->> 'display_name');

  PERFORM public.seed_default_folders(NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- One-time backfill: seed the starter set for every existing account that
-- currently has zero folders (covers accounts created before this change).
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
