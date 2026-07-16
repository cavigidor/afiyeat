-- Structured restaurant mentions per news/rec article, extracted by the
-- generate-news edge function alongside the title/summary. Nullable/empty
-- for older rows and for articles that don't name any specific place.
-- Shape: [{ "name": string, "address": string | null }]
ALTER TABLE public.news_items
  ADD COLUMN IF NOT EXISTS mentioned_restaurants jsonb NOT NULL DEFAULT '[]'::jsonb;
