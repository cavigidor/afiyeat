-- Drop the existing rating constraint and add a new one for 0-10 scale
ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_rating_check;
ALTER TABLE public.restaurants ADD CONSTRAINT restaurants_rating_check CHECK (rating >= 0 AND rating <= 10);