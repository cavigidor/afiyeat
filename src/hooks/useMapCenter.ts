import { useState, useEffect } from 'react';
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
  const [center, setCenter] = useState<Coordinates>(MANHATTAN_DEFAULT);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const determineCenter = async () => {
      // Try the user's location first (native GPS on device, browser API on web)
      try {
        const coords = await getCurrentPosition();
        if (!cancelled) {
          setCenter({ lng: coords.longitude, lat: coords.latitude });
          setIsLoading(false);
          return;
        }
      } catch {
        // Location denied or failed, continue to fallback
      }

      // Fallback: center on restaurant cluster
      const restaurantsWithLocation = restaurants.filter(
        (r) => r.latitude != null && r.longitude != null
      );

      if (restaurantsWithLocation.length > 0 && !cancelled) {
        const avgLat =
          restaurantsWithLocation.reduce((sum, r) => sum + r.latitude!, 0) /
          restaurantsWithLocation.length;
        const avgLng =
          restaurantsWithLocation.reduce((sum, r) => sum + r.longitude!, 0) /
          restaurantsWithLocation.length;

        setCenter({ lng: avgLng, lat: avgLat });
        setIsLoading(false);
        return;
      }

      // Final fallback: Manhattan
      if (!cancelled) {
        setCenter(MANHATTAN_DEFAULT);
        setIsLoading(false);
      }
    };

    determineCenter();

    return () => {
      cancelled = true;
    };
  }, [restaurants]);

  return { center, isLoading };
}
