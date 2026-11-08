-- Retry-safe recipe saves from connected assistants (ChatGPT).
--
-- The afiyeat-mcp edge function lets an assistant the user has connected
-- through OAuth save a finished recipe into their own account. Network
-- retries, or the assistant calling the tool twice, must not create two
-- copies of the same recipe. This adds two nullable columns to recipes:
--
--   source      who created the row outside the app ('chatgpt'), or NULL
--               for recipes made in Afiyeat itself.
--   import_key  a fingerprint of the saved content, computed by the edge
--               function. Unique per user, so a repeated save of the same
--               recipe hits the constraint and the function returns the
--               row that already exists instead of inserting another.
--
-- Additive and backwards-compatible:
--   * Every existing row keeps NULL in both columns. NULLs never collide in
--     a UNIQUE constraint, so recipes made in the app are unaffected and the
--     app keeps inserting exactly as before.
--   * RLS is unchanged. The edge function writes with the user's own token,
--     so the existing "Users can insert own recipes" policy still decides
--     what may be written, and the key is scoped by user_id, so one user's
--     fingerprint can never match (or reveal) another user's recipe.
--   * No data is modified.

ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS import_key TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recipes_source_check'
      AND conrelid = 'public.recipes'::regclass
  ) THEN
    ALTER TABLE public.recipes
      ADD CONSTRAINT recipes_source_check
      CHECK (source IS NULL OR source IN ('chatgpt'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recipes_import_key_check'
      AND conrelid = 'public.recipes'::regclass
  ) THEN
    ALTER TABLE public.recipes
      ADD CONSTRAINT recipes_import_key_check
      CHECK (import_key IS NULL OR char_length(import_key) BETWEEN 8 AND 200);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recipes_user_import_key_key'
      AND conrelid = 'public.recipes'::regclass
  ) THEN
    ALTER TABLE public.recipes
      ADD CONSTRAINT recipes_user_import_key_key UNIQUE (user_id, import_key);
  END IF;
END $$;

COMMENT ON COLUMN public.recipes.source IS
  'Where the recipe was created outside the app (''chatgpt''); NULL for recipes made in Afiyeat.';
COMMENT ON COLUMN public.recipes.import_key IS
  'Content fingerprint set by the afiyeat-mcp edge function; unique per user so retried saves do not duplicate.';
