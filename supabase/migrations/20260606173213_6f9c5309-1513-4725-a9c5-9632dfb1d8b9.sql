CREATE TABLE public.news_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  city TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'news',
  title TEXT NOT NULL,
  summary TEXT,
  source_name TEXT,
  source_url TEXT,
  image_url TEXT,
  published_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.news_items TO anon;
GRANT SELECT ON public.news_items TO authenticated;
GRANT ALL ON public.news_items TO service_role;

ALTER TABLE public.news_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view news items"
ON public.news_items
FOR SELECT
USING (true);

CREATE INDEX idx_news_items_city_published ON public.news_items (city, published_at DESC);

CREATE TABLE public.news_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  city TEXT NOT NULL,
  url TEXT NOT NULL,
  label TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.news_sources TO authenticated;
GRANT ALL ON public.news_sources TO service_role;

ALTER TABLE public.news_sources ENABLE ROW LEVEL SECURITY;