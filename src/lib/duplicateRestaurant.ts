import { supabase } from '@/integrations/supabase/client';

// ~50m at most latitudes - close enough to catch "same place, re-entered by
// hand" without falsely flagging two genuinely different restaurants that
// happen to share a name in different parts of town.
const COORD_MATCH_THRESHOLD = 0.0005;

export interface DuplicateCheckInput {
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string | null;
}

/**
 * True if this user already has a restaurant that's clearly the same real
 * place - checked two ways:
 *  1. Same Mapbox place_id (both entries came from search) - exact, no
 *     ambiguity.
 *  2. Same name (case-insensitive) - if both entries have coordinates, only
 *     counts as a duplicate when the coordinates are also close together;
 *     if either side is missing coordinates (manually typed in), same name
 *     alone is treated as a duplicate to be safe.
 */
export async function isDuplicateRestaurant(
  userId: string,
  input: DuplicateCheckInput,
): Promise<boolean> {
  if (input.placeId) {
    const { data, error } = await supabase
      .from('restaurants')
      .select('id')
      .eq('user_id', userId)
      .eq('place_id', input.placeId)
      .limit(1);
    if (!error && data && data.length > 0) return true;
  }

  const trimmedName = input.name.trim();
  if (!trimmedName) return false;

  const { data: sameName, error } = await supabase
    .from('restaurants')
    .select('id, latitude, longitude')
    .eq('user_id', userId)
    .ilike('name', trimmedName);

  if (error || !sameName || sameName.length === 0) return false;

  if (input.latitude == null || input.longitude == null) {
    return true;
  }

  return sameName.some((r) => {
    if (r.latitude == null || r.longitude == null) return true;
    return (
      Math.abs(r.latitude - input.latitude!) < COORD_MATCH_THRESHOLD &&
      Math.abs(r.longitude - input.longitude!) < COORD_MATCH_THRESHOLD
    );
  });
}
