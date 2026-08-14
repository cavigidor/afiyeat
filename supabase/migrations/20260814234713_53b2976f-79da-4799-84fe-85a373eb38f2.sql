ALTER TABLE public.folders ALTER COLUMN icon SET DEFAULT NULL;

UPDATE public.folders SET icon = NULL WHERE icon = 'folder';