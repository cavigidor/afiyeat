-- Custom-list photo uploads: only into your own folder.
--
-- The custom-list-images INSERT policy (20260814210336) only checked that
-- the uploader was signed in, so any account could write objects into
-- another user's folder (<their user id>/...). They still couldn't read,
-- list, replace or delete anything there (SELECT/DELETE are owner-only and
-- there is no UPDATE policy), but the owner's folder could be filled with
-- files they didn't upload. restaurant-images has required the owner's
-- folder since 20260308184912; this brings custom-list-images in line.
--
-- Policy change only: no buckets, objects or rows are touched, and it is
-- safe to re-run. Existing objects are unaffected (INSERT policies only
-- apply to new uploads). The app already uploads to <user id>/<item id>/...
--
-- Read-only check for objects that were ever written into someone else's
-- folder (should return 0 rows):
--   SELECT o.name, o.owner, o.created_at FROM storage.objects o
--   WHERE o.bucket_id = 'custom-list-images'
--     AND o.owner IS NOT NULL
--     AND o.owner::text <> (storage.foldername(o.name))[1];

DROP POLICY IF EXISTS "Authenticated users can upload custom list images" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload custom list images to own folder" ON storage.objects;
CREATE POLICY "Users can upload custom list images to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'custom-list-images' AND
  auth.uid()::text = (storage.foldername(name))[1]
);
