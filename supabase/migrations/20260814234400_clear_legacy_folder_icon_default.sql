-- folders.icon originally defaulted to the literal string 'folder' (a
-- leftover from an earlier, unused icon-name system - see the original
-- 20251206184716 migration). This session repurposed the column to hold a
-- real user-picked emoji, but every folder that never got one explicitly
-- set - every pre-existing type, plus every default type
-- seed_default_folders() creates for new signups - inherited that literal
-- text and rendered as the word "folder" on its map pin instead of
-- falling back to the plain pin glyph.
ALTER TABLE public.folders ALTER COLUMN icon SET DEFAULT NULL;
UPDATE public.folders SET icon = NULL WHERE icon = 'folder';
