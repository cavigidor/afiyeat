import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

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

  useEffect(() => {
    if (!enabled || userLocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => setUserLocation({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => {},
    );
  }, [enabled, userLocation]);

  useEffect(() => {
    if (!enabled || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timeoutId = setTimeout(async () => {
      setSearching(true);
      try {
        const { data, error } = await supabase.functions.invoke('place-search', {
          body: { query: searchQuery, latitude: userLocation?.lat, longitude: userLocation?.lng, sessionToken },
        });
        if (error) throw error;
        setSearchResults(data.results || []);
        setShowResults(true);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, userLocation, enabled, sessionToken]);

  const selectPlace = (place: PlaceResult) => {
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
