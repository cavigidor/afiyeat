-- Users can already add/rename/delete restaurant types, but there was no
-- way to manually reorder them - display order was always derived from a
-- fixed built-in list (src/lib/typeOrder.ts) with alphabetical fallback.
-- Add a per-user sort_order so the order can be dragged/nudged by the user
-- and actually persists.

ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS sort_order integer;

-- Backfill existing folders to match the previous canonical display order,
-- per user, so upgrading to manual ordering doesn't scramble anyone's
-- current type order on the day this ships. Custom type names not in the
-- canonical list keep sorting alphabetically after the known ones, same
-- as before.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY
        CASE lower(name)
          WHEN 'lunch' THEN 0
          WHEN 'dinner' THEN 1
          WHEN 'breakfast' THEN 2
          WHEN 'brunch' THEN 3
          WHEN 'bakery' THEN 4
          WHEN 'cafe' THEN 5
          WHEN 'coffee' THEN 6
          WHEN 'bar' THEN 7
          WHEN 'sushi' THEN 8
          WHEN 'pizza' THEN 9
          WHEN 'burger' THEN 10
          WHEN 'mexican' THEN 11
          WHEN 'steakhouse' THEN 12
          WHEN 'seafood' THEN 13
          WHEN 'restaurant' THEN 14
          ELSE 15
        END,
        name
    ) - 1 AS rn
  FROM public.folders
)
UPDATE public.folders f
SET sort_order = ranked.rn
FROM ranked
WHERE f.id = ranked.id
  AND f.sort_order IS NULL;

-- Give the starter-set seeding function explicit, intentional positions
-- too, matching the same canonical order, so new accounts start with a
-- sensible order that's then freely reorderable.
CREATE OR REPLACE FUNCTION public.seed_default_folders(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.folders (user_id, name, color, sort_order)
  VALUES
    (p_user_id, 'Lunch', '#FF9800', 0),
    (p_user_id, 'Dinner', '#3F51B5', 1),
    (p_user_id, 'Breakfast', '#FFC107', 2),
    (p_user_id, 'Brunch', '#FF7043', 3),
    (p_user_id, 'Bakery', '#C68958', 4),
    (p_user_id, 'Cafe', '#795548', 5),
    (p_user_id, 'Bar', '#9C27B0', 6);
END;
$$;
