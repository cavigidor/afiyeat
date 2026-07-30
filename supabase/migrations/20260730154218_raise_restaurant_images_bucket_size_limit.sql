-- The restaurant-images bucket's file_size_limit was 5MB (5242880 bytes),
-- separate from and stricter than anything enforced client-side. Photos now
-- get downscaled/re-encoded client-side before upload (see
-- src/lib/imageValidation.ts compressImage()), which should keep uploads
-- well under this in virtually all cases - raising the bucket limit to 8MB
-- to match the client-side backstop (MAX_FILE_SIZE) so the two limits agree
-- and an occasional larger file isn't rejected at the storage layer after
-- passing client-side validation.
UPDATE storage.buckets
SET file_size_limit = 8388608
WHERE id = 'restaurant-images';
