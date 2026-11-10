import { useEffect } from 'react';
import { MapPin, Plus, SearchX } from 'lucide-react';
import { usePlaceAutocomplete, type PlaceResult } from '@/hooks/usePlaceAutocomplete';
import type { ExplorePlace } from '@/components/explore/ExplorePlaceCard';
import { emojiForPlace } from '@/lib/discovery';
import { formatCategory } from '@/components/explore/ExplorePlaceCard';

function toExplorePlace(p: PlaceResult): ExplorePlace {
  return {
    place_id: p.id,
    apple_place_id: p.id,
    name: p.name,
    address: p.address || null,
    latitude: p.latitude,
    longitude: p.longitude,
    category: p.category,
    price_level: null,
    avg_rating: null,
    rating_count: 0,
    contributor_count: 0,
  };
}

/**
 * Place results for the search screen, from Apple Maps (the same search
 * as Add Place, but across all kinds of places, not just food). Tapping a
 * result saves it to one of your lists.
 */
export function PlaceResults({ query, onSave }: { query: string; onSave: (place: ExplorePlace) => void }) {
  // onSelect isn't used: the hook's select flow is built for filling a form
  // field, and here a tap goes straight to "save to a list".
  const { setSearchQuery, searchResults, searching, noResults } = usePlaceAutocomplete({
    kind: 'any',
    onSelect: () => {},
  });

  useEffect(() => {
    setSearchQuery(query);
  }, [query, setSearchQuery]);

  if (query.trim().length < 2) return null;

  if (searching && searchResults.length === 0) {
    return (
      <div className="space-y-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border bg-card p-3">
            <div className="h-10 w-10 rounded-lg bg-muted animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-2/5 rounded bg-muted animate-pulse" />
              <div className="h-3 w-4/5 rounded bg-muted/70 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (noResults) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
        <SearchX className="h-8 w-8 opacity-60" />
        <p>No places found for "{query}".</p>
      </div>
    );
  }

  return (
    <ul className={`space-y-2 transition-opacity ${searching ? 'opacity-60' : ''}`}>
      {searchResults.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            onClick={() => onSave(toExplorePlace(p))}
            className="active-press flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left shadow-sm transition-[background-color,transform] duration-150 ease-out active:bg-muted/60"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-xl" aria-hidden>
              {emojiForPlace(p.category)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{p.name}</span>
              <span className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{[formatCategory(p.category), p.address].filter(Boolean).join(' · ')}</span>
              </span>
            </span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Plus className="h-4 w-4" />
              <span className="sr-only">Save</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
