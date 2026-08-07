ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS sort_order integer;

WITH ordered AS (
  SELECT id, (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at, name) - 1) AS rn
  FROM public.folders
)
UPDATE public.folders f
SET sort_order = o.rn
FROM ordered o
WHERE f.id = o.id AND f.sort_order IS NULL;