import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getCurrentPosition } from '@/lib/native';

export interface PlaceResult {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  mapboxId?: string;
}

export interface ResolvedPlace {
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  category: string | null;
}

interface UsePlaceAutocompleteOptions {
  // Gates both the geolocation lookup and the search itself - pass false
  // for dialogs where the place search is conditionally shown (e.g. a
  // custom list with show_location off, or a dialog that isn't open yet).
  enabled?: boolean;
  onSelect: (place: ResolvedPlace) => void;
}

// Shared search-and-select logic behind every "search for a place" field in
// the app (restaurants, custom list items, shared list items, mentioned
// places) - this used to be copy-pasted four times, which is how the same
// bugs (no instant fill, dropdown not scrolling on mobile) kept needing to
// be fixed four separate times. Pair with PlaceResultsDropdown, which
// renders the results list this returns.
export function usePlaceAutocomplete({ enabled = true, onSelect }: UsePlaceAutocompleteOptions) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [sessionToken] = useState(() => crypto.randomUUID());
  // Responses can arrive out of order. Each search and each selection gets
  // a sequence number, and only the latest one is allowed to write state -
  // so a slow lookup for an earlier query or an earlier pick can't
  // overwrite what the user chose since.
  const searchSeq = useRef(0);
  const selectSeq = useRef(0);
  // The text a selection writes into the field shouldn't trigger a fresh
  // search that reopens the dropdown the user just closed by choosing.
  const selectedQuery = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || userLocation) return;
    // getCurrentPosition() (not raw navigator.geolocation) so this routes
    // through the native Capacitor plugin on iOS/Android instead of relying
    // on the web geolocation API inside the WebView, which doesn't reliably
    // trigger the native permission prompt on its own.
    getCurrentPosition()
      .then((coords) => setUserLocation({ lat: coords.latitude, lng: coords.longitude }))
      .catch(() => {});
  }, [enabled, userLocation]);

  useEffect(() => {
    const seq = ++searchSeq.current;
    if (!enabled || searchQuery.length < 2) {
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
        const { data, error } = await supabase.functions.invoke('place-search', {
          body: { query: searchQuery, latitude: userLocation?.lat, longitude: userLocation?.lng, sessionToken },
        });
        if (seq !== searchSeq.current) return;
        if (error) throw error;
        setSearchResults(data.results || []);
        setShowResults(true);
      } catch (err) {
        if (seq === searchSeq.current) console.error('Search error:', err);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, userLocation, enabled, sessionToken]);

  const selectPlace = (place: PlaceResult) => {
    const seq = ++selectSeq.current;
    // Invalidate any search still in flight, and don't start a new one for
    // the name we're about to write into the field.
    searchSeq.current++;
    setSearching(false);
    selectedQuery.current = place.name;
    setSearchQuery(place.name);
    setShowResults(false);
    setSearchResults([]);

    // Fill instantly from the suggest-endpoint result already in hand -
    // nothing here waits on a network round trip before name/address
    // visibly update, which is what caused the "buffer" before fields
    // would fill in. If the suggest result didn't come with coordinates,
    // place-retrieve below silently upgrades them a moment later; it never
    // gates the initial, visible fill.
    onSelect({
      name: place.name,
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
      placeId: place.mapboxId || null,
      category: place.category,
    });

    if (place.mapboxId && (place.latitude === null || place.longitude === null)) {
      supabase.functions
        .invoke('place-retrieve', { body: { mapboxId: place.mapboxId, sessionToken } })
        .then(({ data, error }) => {
          // The user picked something else while this was loading.
          if (seq !== selectSeq.current) return;
          if (error) throw error;
          const result = data.result;
          onSelect({
            name: result.name,
            address: result.address || '',
            latitude: result.latitude ?? null,
            longitude: result.longitude ?? null,
            placeId: result.id || place.mapboxId || null,
            category: result.category ?? place.category,
          });
        })
        .catch((err) => console.error('Retrieve error:', err));
    }
  };

  const resetSearch = () => {
    selectSeq.current++;
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
