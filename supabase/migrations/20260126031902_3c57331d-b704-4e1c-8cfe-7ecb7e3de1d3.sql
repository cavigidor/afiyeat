-- Create recipes table
CREATE TABLE public.recipes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  prep_time_minutes INTEGER,
  cook_time_minutes INTEGER,
  servings INTEGER,
  cook_temp INTEGER,
  cook_temp_unit TEXT DEFAULT 'F',
  difficulty TEXT DEFAULT 'medium',
  ingredients JSONB DEFAULT '[]'::jsonb,
  instructions JSONB DEFAULT '[]'::jsonb,
  tags TEXT[] DEFAULT '{}',
  image_url TEXT,
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;

-- Users can view their own recipes
CREATE POLICY "Users can view own recipes"
ON public.recipes
FOR SELECT
USING (auth.uid() = user_id);

-- Users can view public recipes from others
CREATE POLICY "Users can view public recipes"
ON public.recipes
FOR SELECT
USING (is_public = true);

-- Users can insert their own recipes
CREATE POLICY "Users can insert own recipes"
ON public.recipes
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own recipes
CREATE POLICY "Users can update own recipes"
ON public.recipes
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own recipes
CREATE POLICY "Users can delete own recipes"
ON public.recipes
FOR DELETE
USING (auth.uid() = user_id);

-- Add trigger for updated_at
CREATE TRIGGER update_recipes_updated_at
BEFORE UPDATE ON public.recipes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();