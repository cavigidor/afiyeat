import { useState, useEffect, useMemo } from 'react';
import { getCurrentPosition } from '@/lib/native';

interface Coordinates {
  lng: number;
  lat: number;
}

interface Restaurant {
  latitude?: number | null;
  longitude?: number | null;
}

const MANHATTAN_DEFAULT: Coordinates = { lng: -74.006, lat: 40.7128 };

export function useMapCenter(restaurants: Restaurant[] = []) {
  const [gpsCenter, setGpsCenter] = useState<Coordinates | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Ask for the device's GPS position once. This used to be re-run (and the
  // caller's Mapbox map fully torn down and rebuilt) on every render that
  // happened to pass a new `restaurants` array reference - callers commonly
  // do `.filter()` inline, which creates a new array every render.
  useEffect(() => {
    let cancelled = false;

    getCurrentPosition()
      .then((coords) => {
        if (!cancelled) setGpsCenter({ lng: coords.longitude, lat: coords.latitude });
      })
      .catch(() => {
        // Location denied or failed - fall back to the restaurant cluster below.
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Depend on the actual coordinates, not the array reference, so this only
  // recomputes when the underlying locations genuinely change.
  const locationSignature = restaurants
    .filter((r) => r.latitude != null && r.longitude != null)
    .map((r) => `${r.latitude},${r.longitude}`)
    .join(';');

  const fallbackCenter = useMemo<Coordinates>(() => {
    const withLocation = restaurants.filter((r) => r.latitude != null && r.longitude != null);
    if (withLocation.length === 0) return MANHATTAN_DEFAULT;

    const avgLat = withLocation.reduce((sum, r) => sum + r.latitude!, 0) / withLocation.length;
    const avgLng = withLocation.reduce((sum, r) => sum + r.longitude!, 0) / withLocation.length;
    return { lng: avgLng, lat: avgLat };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationSignature]);

  const center = gpsCenter ?? fallbackCenter;

  return { center, isLoading };
}
