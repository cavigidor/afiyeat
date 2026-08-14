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

// Shared by isDuplicateRestaurant and isDuplicateSharedItem: given the set
// of same-named rows already scoped to the right table/owner, decides
// whether `input` counts as "the same real place" - same name alone is only
// a duplicate when neither side has coordinates to actually disambiguate
// with, or when the coordinates are also close together. A different
// location for the same name (e.g. two branches of a chain) is NOT a
// duplicate.
function matchesByNameAndLocation(
  rows: { latitude: number | null; longitude: number | null }[],
  input: DuplicateCheckInput,
): boolean {
  if (rows.length === 0) return false;
  if (input.latitude == null || input.longitude == null) return true;
  return rows.some((r) => {
    if (r.latitude == null || r.longitude == null) return true;
    return (
      Math.abs(r.latitude - input.latitude!) < COORD_MATCH_THRESHOLD &&
      Math.abs(r.longitude - input.longitude!) < COORD_MATCH_THRESHOLD
    );
  });
}

/**
 * True if this user already has a restaurant that's clearly the same real
 * place - checked two ways:
 *  1. Same Mapbox place_id (both entries came from search) - exact, no
 *     ambiguity.
 *  2. Same name (case-insensitive) - see matchesByNameAndLocation above.
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

  if (error || !sameName) return false;
  return matchesByNameAndLocation(sameName, input);
}

/**
 * Same rule as isDuplicateRestaurant, scoped to a single shared list instead
 * of a single user's restaurants - a shared list shouldn't end up with the
 * same place added twice (by either member), but the same name at a
 * different location is still allowed.
 */
export async function isDuplicateSharedItem(
  listId: string,
  input: DuplicateCheckInput,
): Promise<boolean> {
  const trimmedName = input.name.trim();
  if (!trimmedName) return false;

  const { data: sameName, error } = await supabase
    .from('shared_list_items')
    .select('id, latitude, longitude')
    .eq('list_id', listId)
    .ilike('name', trimmedName);

  if (error || !sameName) return false;
  return matchesByNameAndLocation(sameName, input);
}

/**
 * Same rule again, scoped to a single My Lists custom list.
 */
export async function isDuplicateCustomListItem(
  listId: string,
  input: DuplicateCheckInput,
): Promise<boolean> {
  const trimmedName = input.name.trim();
  if (!trimmedName) return false;

  const { data: sameName, error } = await supabase
    .from('custom_list_items')
    .select('id, latitude, longitude')
    .eq('list_id', listId)
    .ilike('name', trimmedName);

  if (error || !sameName) return false;
  return matchesByNameAndLocation(sameName, input);
}
