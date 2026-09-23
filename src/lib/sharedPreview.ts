import { supabase } from '@/integrations/supabase/client';

/**
 * Reads one shared restaurant, recipe or list for someone who followed a
 * link - including people without an account.
 *
 * Goes through get_shared_preview (see the 20260922120000 migration), which
 * returns a single item by id with a deliberately small set of fields. It
 * returns nothing for private profiles and non-public recipes, so a null
 * here means "not available to you", not an error.
 */

export interface SharedOwner {
  user_id: string;
  display_name: string | null;
  username: string | null;
  avatar_emoji: string | null;
  avatar_color: string | null;
}

export interface RestaurantPreview {
  type: 'restaurant';
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  rating: number | null;
  price_level: number | null;
  status: string;
  latitude: number | null;
  longitude: number | null;
  place_id: string | null;
  owner: SharedOwner;
}

export interface RecipePreview {
  type: 'recipe';
  id: string;
  title: string;
  description: string | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  servings: number | null;
  difficulty: string | null;
  cook_temp: number | null;
  cook_temp_unit: string | null;
  ingredients: string[] | null;
  instructions: string[] | null;
  tags: string[] | null;
  image_url: string | null;
  owner: SharedOwner;
}

export interface ListPreview {
  type: 'custom_list';
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  item_count: number;
  items: { name: string; address: string | null }[];
  owner: SharedOwner;
}

// Ids arrive from the URL. Checking the shape first means a mangled link
// shows the friendly "not available" state rather than a database error.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return !!value && UUID_RE.test(value);
}

async function fetchPreview<T>(type: string, id: string): Promise<T | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await supabase.rpc('get_shared_preview', { p_type: type, p_id: id });
  if (error) {
    console.error('get_shared_preview failed:', error);
    return null;
  }
  return (data as T | null) ?? null;
}

export const fetchRestaurantPreview = (id: string) => fetchPreview<RestaurantPreview>('restaurant', id);
export const fetchRecipePreview = (id: string) => fetchPreview<RecipePreview>('recipe', id);
export const fetchListPreview = (id: string) => fetchPreview<ListPreview>('custom_list', id);

export function ownerName(owner: SharedOwner | null | undefined): string {
  return owner?.display_name?.trim() || owner?.username || 'An Afiyeat member';
}
