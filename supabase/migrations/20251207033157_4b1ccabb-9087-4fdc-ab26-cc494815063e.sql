-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Users can view accessible profiles" ON public.profiles;

-- Create a more permissive policy that allows viewing public profiles directly
-- without recursive function calls that might cause issues
CREATE POLICY "Users can view accessible profiles" 
ON public.profiles 
FOR SELECT 
USING (
  -- User can always view their own profile
  auth.uid() = user_id
  OR
  -- Public profiles are viewable by anyone
  is_private = false
  OR
  -- Private profiles viewable by accepted followers
  EXISTS (
    SELECT 1 FROM public.follows 
    WHERE follower_id = auth.uid() 
      AND following_id = profiles.user_id 
      AND status = 'accepted'
  )
);