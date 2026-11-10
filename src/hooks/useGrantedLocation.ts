import { useQuery } from '@tanstack/react-query';
import { getCurrentPositionIfGranted } from '@/lib/native';
import type { Origin } from '@/lib/discovery';

/**
 * The user's location - but only if they've already allowed it somewhere
 * else (a map's Near Me, Events). Never shows a permission prompt, so it's
 * safe on screens people land on without asking for anything, like Home.
 * null means "not allowed (yet)", and callers fall back to something that
 * doesn't need location.
 */
export function useGrantedLocation(enabled = true) {
  return useQuery<Origin | null>({
    queryKey: ['granted-location'],
    queryFn: async () => {
      const coords = await getCurrentPositionIfGranted();
      return coords ? { lat: coords.latitude, lng: coords.longitude } : null;
    },
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}
