-- Make the restaurant-images bucket private
UPDATE storage.buckets 
SET public = false 
WHERE id = 'restaurant-images';

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can view restaurant images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view restaurant images" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own images" ON storage.objects;
DROP POLICY IF EXISTS "Users can view images from followed users" ON storage.objects;

-- Create policy for users to view their own images
CREATE POLICY "Users can view own images"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'restaurant-images' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Create policy for users to view images from users they follow (accepted follows only)
CREATE POLICY "Users can view images from followed users"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'restaurant-images' AND
  EXISTS (
    SELECT 1 FROM public.follows
    WHERE follower_id = auth.uid()
    AND following_id = (storage.foldername(name))[1]::uuid
    AND status = 'accepted'
  )
);