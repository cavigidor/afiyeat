import { useEffect, useRef, useState } from 'react';
import { getCurrentPositionIfGranted } from '@/lib/native';
import { searchApplePlaces } from '@/lib/appleMaps';

export interface PlaceResult {
  /** Apple place ID. */
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
}

export interface ResolvedPlace {
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  /** Apple place ID - the only part of a search result that gets stored. */
  applePlaceId: string | null;
  /** Legacy Mapbox ID. Always null now; kept so older callers compile. */
  placeId: string | null;
  category: string | null;
}

interface UsePlaceAutocompleteOptions {
  // Gates both the location lookup and the search itself - pass false
  // for dialogs where the place search is conditionally shown (e.g. a
  // custom list with show_location off, or a dialog that isn't open yet).
  enabled?: boolean;
  /** 'food' (default) limits results to restaurants, cafes, bars etc. */
  kind?: 'food' | 'any';
  onSelect: (place: ResolvedPlace) => void;
}

// Shared search-and-select logic behind every "search for a place" field in
// the app (restaurants, custom list items, shared list items, mentioned
// places). Pair with PlaceResultsDropdown, which renders the results.
//
// Search runs on Apple Maps through the apple-maps edge function. Results
// already include coordinates, so selecting one fills the form instantly
// with no second lookup.
export function usePlaceAutocomplete({ enabled = true, kind = 'food', onSelect }: UsePlaceAutocompleteOptions) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  // Responses can arrive out of order. Each search gets a sequence number,
  // and only the latest one is allowed to write state, so a slow lookup for
  // an earlier query can't overwrite what the user chose since.
  const searchSeq = useRef(0);
  // The text a selection writes into the field shouldn't trigger a fresh
  // search that reopens the dropdown the user just closed by choosing.
  const selectedQuery = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || userLocation) return;
    // Bias results toward where the user is, but only if they've already
    // allowed location - opening a dialog never triggers a permission prompt.
    getCurrentPositionIfGranted()
      .then((coords) => {
        if (coords) setUserLocation({ lat: coords.latitude, lng: coords.longitude });
      })
      .catch(() => {});
  }, [enabled, userLocation]);

  useEffect(() => {
    const seq = ++searchSeq.current;
    if (!enabled || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    if (selectedQuery.current !== null && searchQuery === selectedQuery.current) {
      return;
    }
    selectedQuery.current = null;

    const timeoutId = setTimeout(async () => {
      setSearching(true);
      try {
        const places = await searchApplePlaces(searchQuery, {
          latitude: userLocation?.lat,
          longitude: userLocation?.lng,
          kind,
        });
        if (seq !== searchSeq.current) return;
        setSearchResults(
          places
            .filter((p) => p.name)
            .map((p) => ({
              id: p.id,
              name: p.name ?? '',
              address: p.address ?? '',
              latitude: p.latitude,
              longitude: p.longitude,
              category: p.category,
            })),
        );
        setShowResults(true);
      } catch (err) {
        if (seq === searchSeq.current) console.error('Search error:', err);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, userLocation, enabled, kind]);

  const selectPlace = (place: PlaceResult) => {
    // Invalidate any search still in flight, and don't start a new one for
    // the name we're about to write into the field.
    searchSeq.current++;
    setSearching(false);
    selectedQuery.current = place.name;
    setSearchQuery(place.name);
    setShowResults(false);
    setSearchResults([]);

    onSelect({
      name: place.name,
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
      applePlaceId: place.id,
      placeId: null,
      category: place.category,
    });
  };

  const resetSearch = () => {
    searchSeq.current++;
    selectedQuery.current = null;
    setSearching(false);
    setSearchQuery('');
    setSearchResults([]);
    setShowResults(false);
  };

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    searching,
    showResults,
    setShowResults,
    userLocation,
    selectPlace,
    resetSearch,
  };
}
