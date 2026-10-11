import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { Search as SearchIcon, X, ChevronRight, ArrowLeft } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { PlaceResults } from '@/components/search/PlaceResults';
import { PeopleResults } from '@/components/search/PeopleResults';
import { ListResults } from '@/components/search/ListResults';
import { AddExplorePlaceDialog } from '@/components/explore/AddExplorePlaceDialog';
import type { ExplorePlace } from '@/components/explore/ExplorePlaceCard';

type SearchType = 'places' | 'people' | 'lists';
const TYPES: { id: SearchType; label: string; hint: string }[] = [
  { id: 'places', label: 'Places', hint: 'Restaurants, cafés, bars, anywhere' },
  { id: 'people', label: 'People', hint: 'Find friends by name or username' },
  { id: 'lists', label: 'Lists', hint: 'Lists people on Afiyeat are building' },
];

const isType = (v: string | null): v is SearchType => !!v && TYPES.some((t) => t.id === v);

/**
 * One search for everything Afiyeat can search today: places (Apple
 * Maps), people (profiles) and lists (community lists). Events have their
 * own keyword search in Explore, which this hands off to rather than
 * duplicating. Reached from Home's search bar; /search used to be "Find
 * People", which is the People tab here.
 */
export default function Search() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [type, setType] = useState<SearchType>(isType(params.get('type')) ? (params.get('type') as SearchType) : 'places');
  const [savePlace, setSavePlace] = useState<ExplorePlace | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [user, authLoading, navigate]);

  // Keep the query and tab in the URL, so going back to this screen (or
  // sharing it) restores the same search.
  useEffect(() => {
    const id = setTimeout(() => {
      const next = new URLSearchParams();
      if (query.trim()) next.set('q', query.trim());
      if (type !== 'places') next.set('type', type);
      setParams(next, { replace: true });
    }, 400);
    return () => clearTimeout(id);
  }, [query, type, setParams]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const trimmed = query.trim();
  const hint = TYPES.find((t) => t.id === type)?.hint;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container max-w-2xl py-4 sm:py-8 px-4 sm:px-6 space-y-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/explore'))}
            aria-label="Back"
            className="active-press -ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-opacity active:opacity-60"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              autoFocus
              enterKeyHint="search"
              placeholder="Search places, people, lists…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.blur()}
              className="h-11 rounded-full pl-10 pr-10"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground active:opacity-60"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <Tabs value={type} onValueChange={(v) => setType(v as SearchType)}>
          <TabsList className="w-full">
            {TYPES.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="flex-1">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {trimmed.length < 2 ? (
          <p className="pt-6 text-center text-sm text-muted-foreground">{hint}</p>
        ) : type === 'places' ? (
          <PlaceResults query={query} onSave={setSavePlace} />
        ) : type === 'people' ? (
          <PeopleResults query={query} />
        ) : (
          <ListResults query={query} />
        )}

        {trimmed.length >= 2 && (
          <Link
            to={`/explore?c=events&q=${encodeURIComponent(trimmed)}`}
            className="active-press flex items-center gap-3 rounded-xl border border-dashed p-3 text-sm transition-[background-color,transform] duration-150 ease-out active:bg-muted/60"
          >
            <span aria-hidden className="text-lg">🎟️</span>
            <span className="min-w-0 flex-1 truncate">
              Search events for <span className="font-medium">"{trimmed}"</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        )}
      </main>

      <AddExplorePlaceDialog
        open={!!savePlace}
        onOpenChange={(open) => !open && setSavePlace(null)}
        place={savePlace}
      />
    </div>
  );
}
