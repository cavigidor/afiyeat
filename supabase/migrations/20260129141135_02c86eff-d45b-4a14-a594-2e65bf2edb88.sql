-- Drop the existing permissive SELECT policy that allows anonymous access
DROP POLICY IF EXISTS "Users can view accessible profiles" ON public.profiles;

-- Create a new policy that requires authentication
CREATE POLICY "Authenticated users can view accessible profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  (auth.uid() = user_id) 
  OR (is_private = false) 
  OR (EXISTS (
    SELECT 1 FROM public.follows 
    WHERE follows.follower_id = auth.uid() 
      AND follows.following_id = profiles.user_id 
      AND follows.status = 'accepted'
  ))
);