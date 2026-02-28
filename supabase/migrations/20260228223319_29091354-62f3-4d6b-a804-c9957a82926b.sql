
-- Create cellar_items table for tracking wines and beers
CREATE TABLE public.cellar_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'beer', -- 'beer' or 'wine'
  is_preset BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cellar_items ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own cellar items"
ON public.cellar_items FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own cellar items"
ON public.cellar_items FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own cellar items"
ON public.cellar_items FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own cellar items"
ON public.cellar_items FOR DELETE
USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_cellar_items_updated_at
BEFORE UPDATE ON public.cellar_items
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
