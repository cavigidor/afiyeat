-- 1. Create security definer function to check if user can view a profile
CREATE OR REPLACE FUNCTION public.can_view_profile(profile_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    -- User can always view their own profile
    auth.uid() = profile_user_id
    OR
    -- Can view if profile is public
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE user_id = profile_user_id AND is_private = false
    )
    OR
    -- Can view if accepted follower
    EXISTS (
      SELECT 1 FROM public.follows 
      WHERE follower_id = auth.uid() 
        AND following_id = profile_user_id 
        AND status = 'accepted'
    )
$$;

-- 2. Drop old policy and create new privacy-respecting policy
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;

CREATE POLICY "Users can view accessible profiles" ON public.profiles
FOR SELECT USING (public.can_view_profile(user_id));