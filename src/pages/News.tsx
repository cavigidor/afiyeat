import { useState, useEffect } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { supabase } from '@/integrations/supabase/client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Newspaper, Sparkles, MapPin, ExternalLink, Calendar } from 'lucide-react';

interface NewsItem {
  id: string;
  city: string;
  type: string;
  title: string;
  summary: string | null;
  source_name: string | null;
  source_url: string | null;
  image_url: string | null;
  published_at: string;
}

const CITIES = [
  { value: 'new_york', label: 'New York' },
  { value: 'los_angeles', label: 'Los Angeles' },
  { value: 'chicago', label: 'Chicago' },
];

// Map a US state short_code (e.g. "US-CA") to the closest covered city.
// California -> Los Angeles, New York -> New York, Illinois -> Chicago.
// Anything else (or denied location) -> Chicago.
const STATE_TO_CITY: Record<string, string> = {
  'US-CA': 'los_angeles',
  'US-NY': 'new_york',
  'US-IL': 'chicago',
};
const DEFAULT_CITY = 'chicago';

export default function News() {
  // If the user has manually picked a city before, respect it. Otherwise we
  // detect from their location on mount.
  const [city, setCity] = useState<string>(() => {
    return localStorage.getItem('news_city_manual') || DEFAULT_CITY;
  });
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Detect default city from geolocation on first visit (no manual choice yet).
  useEffect(() => {
    if (localStorage.getItem('news_city_manual')) return;

    let cancelled = false;

    const applyDetected = (detected: string) => {
      if (!cancelled) setCity(detected);
    };

    if (!('geolocation' in navigator)) {
      applyDetected(DEFAULT_CITY);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { data } = await supabase.functions.invoke('reverse-geocode-region', {
            body: {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            },
          });
          const shortCode: string | undefined = data?.shortCode?.toUpperCase?.();
          applyDetected((shortCode && STATE_TO_CITY[shortCode]) || DEFAULT_CITY);
        } catch {
          applyDetected(DEFAULT_CITY);
        }
      },
      // Denied or unavailable -> default to Chicago.
      () => applyDetected(DEFAULT_CITY),
      { timeout: 8000 },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    fetchNews(city);
  }, [city]);

  const handleCityChange = (value: string) => {
    // A manual pick takes precedence over geolocation from now on.
    localStorage.setItem('news_city_manual', value);
    setCity(value);
  };

  const fetchNews = async (selectedCity: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('news_items')
      .select('*')
      .eq('city', selectedCity)
      .order('published_at', { ascending: false });
    if (!error && data) {
      setItems(data as NewsItem[]);
    }
    setLoading(false);
  };


  const cityLabel = CITIES.find((c) => c.value === city)?.label ?? '';
  const news = items.filter((i) => i.type === 'news');
  const recs = items.filter((i) => i.type === 'rec');

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Header */}
      <section className="relative overflow-hidden border-b border-border/40">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-accent/20 to-background" />
        <div className="container relative py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-primary mb-2">
                <Newspaper className="h-5 w-5" />
                <span className="text-sm font-medium uppercase tracking-wide">News &amp; Recs</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold leading-tight">
                What&apos;s happening in {cityLabel}
              </h1>
              <p className="text-muted-foreground mt-2 max-w-xl">
                Your daily digest of restaurant openings, food news, and recommendations — updated every day.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <Select value={city} onValueChange={setCity}>
                <SelectTrigger className="w-[180px] bg-card">
                  <SelectValue placeholder="Choose city" />
                </SelectTrigger>
                <SelectContent>
                  {CITIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </section>

      <div className="container px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-24 max-w-md mx-auto">
            <Newspaper className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">No updates yet for {cityLabel}</h2>
            <p className="text-muted-foreground">
              Daily news and recommendations will appear here once sources are added for this city.
            </p>
          </div>
        ) : (
          <div className="space-y-12">
            {/* News */}
            {news.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-5">
                  <Newspaper className="h-5 w-5 text-primary" />
                  <h2 className="text-2xl font-bold">Latest News</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {news.map((item) => (
                    <NewsCard key={item.id} item={item} />
                  ))}
                </div>
              </section>
            )}

            {/* Recommendations */}
            {recs.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-5">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <h2 className="text-2xl font-bold">Recommendations</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {recs.map((item) => (
                    <NewsCard key={item.id} item={item} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  const dateLabel = new Date(item.published_at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    item.source_url ? (
      <a
        href={item.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="block group"
      >
        {children}
      </a>
    ) : (
      <div>{children}</div>
    );

  return (
    <Wrapper>
      <Card className="h-full overflow-hidden transition-shadow hover:shadow-lg">
        {item.image_url && (
          <div className="aspect-video overflow-hidden bg-muted">
            <img
              src={item.image_url}
              alt={item.title}
              loading="lazy"
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          </div>
        )}
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span>{dateLabel}</span>
            {item.source_name && (
              <>
                <span>·</span>
                <Badge variant="secondary" className="font-normal">
                  {item.source_name}
                </Badge>
              </>
            )}
          </div>
          <h3 className="font-semibold text-lg leading-snug mb-2 group-hover:text-primary transition-colors">
            {item.title}
          </h3>
          {item.summary && (
            <p className="text-sm text-muted-foreground line-clamp-4">{item.summary}</p>
          )}
          {item.source_url && (
            <div className="flex items-center gap-1 mt-3 text-sm text-primary font-medium">
              Read more <ExternalLink className="h-3 w-3" />
            </div>
          )}
        </CardContent>
      </Card>
    </Wrapper>
  );
}
