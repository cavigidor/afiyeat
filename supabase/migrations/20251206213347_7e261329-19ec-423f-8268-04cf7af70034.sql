-- Add is_private column to profiles
ALTER TABLE public.profiles ADD COLUMN is_private boolean NOT NULL DEFAULT false;

-- Add status column to follows table for friend request system
ALTER TABLE public.follows ADD COLUMN status text NOT NULL DEFAULT 'accepted';

-- Add check constraint for valid status values
ALTER TABLE public.follows ADD CONSTRAINT follows_status_check CHECK (status IN ('pending', 'accepted'));

-- Update RLS policy for viewing restaurants - only show from accepted follows
DROP POLICY IF EXISTS "Users can view restaurants of people they follow" ON public.restaurants;
CREATE POLICY "Users can view restaurants of people they follow" 
ON public.restaurants 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM follows 
    WHERE follows.follower_id = auth.uid() 
    AND follows.following_id = restaurants.user_id
    AND follows.status = 'accepted'
  )
);

-- Update RLS policy for restaurant images - only show from accepted follows
DROP POLICY IF EXISTS "Users can view images from followed users" ON public.restaurant_images;
CREATE POLICY "Users can view images from followed users" 
ON public.restaurant_images 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM follows 
    WHERE follows.follower_id = auth.uid() 
    AND follows.following_id = restaurant_images.user_id
    AND follows.status = 'accepted'
  )
);

-- Allow users to update their own follows (for accepting/rejecting requests)
DROP POLICY IF EXISTS "Users can update follows" ON public.follows;
CREATE POLICY "Users can update follows" 
ON public.follows 
FOR UPDATE 
USING (auth.uid() = following_id);

-- Allow viewing pending requests sent to user
DROP POLICY IF EXISTS "Users can view their follows" ON public.follows;
CREATE POLICY "Users can view their follows" 
ON public.follows 
FOR SELECT 
USING (
  auth.uid() = follower_id 
  OR auth.uid() = following_id
);