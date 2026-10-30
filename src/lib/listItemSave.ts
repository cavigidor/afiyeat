import { supabase } from '@/integrations/supabase/client';
import {
  isDuplicateCustomListItem,
  isDuplicateRestaurant,
  isDuplicateSharedItem,
} from '@/lib/duplicateRestaurant';
import { locationColumns, placeColumnsForSave, resolveApplePlaces, type PickedPlace } from '@/lib/appleMaps';
import type { CustomList } from '@/components/lists/CreateListDialog';

/**
 * Saving a new item to each kind of list - the one implementation used by
 * the per-list add dialogs (AddRestaurantDialog, AddCustomListItemDialog,
 * AddSharedItemDialog) and by the universal Add Item on the Lists screen.
 *
 * Each function runs the destination's duplicate check, builds the row the
 * same way its dialog always has, inserts it, warms Apple's place details
 * for an Apple-backed place, and uploads photos where the destination has
 * them. Nothing here shows UI: callers decide what to say, from the result.
 */

// Discriminated on a string (not a boolean) so it narrows without
// strictNullChecks, which this project doesn't enable.
export type SaveResult =
  | { status: 'saved'; id: string }
  | { status: 'duplicate' }
  | { status: 'error'; error: unknown };

/** What the user entered about the thing itself, whatever list it goes to. */
export interface ItemBasics {
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Set when the place was picked from Apple search. */
  picked?: PickedPlace | null;
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/**
 * Uploads photos for a saved restaurant. A failed upload is logged and
 * skipped, as before - the restaurant itself is already saved.
 */
export async function uploadRestaurantPhotos(userId: string, restaurantId: string, files: File[]): Promise<void> {
  for (const image of files) {
    const fileExt = image.name.split('.').pop();
    const fileName = `${userId}/${restaurantId}/${crypto.randomUUID()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage.from('restaurant-images').upload(fileName, image);
    if (uploadError) {
      console.error('Image upload error:', uploadError);
      continue;
    }
    const storagePath = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/restaurant-images/${fileName}`;
    await supabase.from('restaurant_images').insert({
      restaurant_id: restaurantId,
      user_id: userId,
      image_url: storagePath,
    });
  }
}

/** Uploads photos for a saved custom-list item (same skip-on-failure rule). */
export async function uploadCustomListPhotos(userId: string, itemId: string, files: File[]): Promise<void> {
  for (const image of files) {
    const fileExt = image.name.split('.').pop();
    const fileName = `${userId}/${itemId}/${crypto.randomUUID()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage.from('custom-list-images').upload(fileName, image);
    if (uploadError) {
      console.error('Image upload error:', uploadError);
      continue;
    }
    const storagePath = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/custom-list-images/${fileName}`;
    await supabase.from('custom_list_item_images').insert({
      item_id: itemId,
      user_id: userId,
      image_url: storagePath,
    });
  }
}

// ---------------------------------------------------------------------------
// My Restaurants
// ---------------------------------------------------------------------------

export interface RestaurantFields {
  status: 'to_go' | 'went_to';
  folderIds: string[];
  /** Only kept for Been There, as before. */
  rating?: number | null;
  priceLevel?: number | null;
  notes?: string | null;
  /** Apple POI category of a searched place. */
  category?: string | null;
  photos?: File[];
}

export async function saveRestaurant(userId: string, item: ItemBasics, fields: RestaurantFields): Promise<SaveResult> {
  try {
    const duplicate = await isDuplicateRestaurant(userId, {
      name: item.name,
      latitude: item.latitude,
      longitude: item.longitude,
      applePlaceId: item.picked?.applePlaceId,
    });
    if (duplicate) return { status: 'duplicate' };

    const { data: restaurant, error } = await supabase
      .from('restaurants')
      .insert({
        user_id: userId,
        name: item.name.trim(),
        // Only the Apple place ID is stored for a place picked from search;
        // its address and pin are shown from Apple's short-lived cache.
        ...placeColumnsForSave(item.picked ?? null, {
          address: item.address,
          latitude: item.latitude,
          longitude: item.longitude,
        }),
        place_id: null,
        notes: fields.notes?.trim() || null,
        status: fields.status,
        folder_ids: fields.folderIds,
        category: fields.category ?? null,
        rating: fields.status === 'to_go' ? null : fields.rating || null,
        price_level: fields.priceLevel || null,
        visited_at: fields.status === 'went_to' ? new Date().toISOString() : null,
      })
      .select()
      .single();
    if (error) throw error;

    // Fetch Apple's details into the short-lived cache now, so the new
    // place appears on lists and maps straight away.
    if (restaurant.apple_place_id) void resolveApplePlaces([restaurant.apple_place_id]);
    if (fields.photos?.length) await uploadRestaurantPhotos(userId, restaurant.id, fields.photos);
    return { status: 'saved', id: restaurant.id };
  } catch (error) {
    return { status: 'error', error };
  }
}

// ---------------------------------------------------------------------------
// Custom lists (My Lists)
// ---------------------------------------------------------------------------

export interface CustomListFields {
  statusId: string | null;
  typeIds: string[];
  priceLevel?: number | null;
  /** Typed price, for lists whose price mode is "manual". */
  priceManual?: string;
  rating?: number | null;
  /** Typed rating, for lists whose rating mode is "manual". */
  ratingManual?: string;
  notes?: string | null;
  photos?: File[];
}

/**
 * The row for a custom-list item, honouring the list's settings: fields
 * the list doesn't use are stored empty, whatever the form held. Shared
 * by add and edit in AddCustomListItemDialog.
 */
export function customListItemPayload(
  list: Pick<CustomList, 'show_location' | 'show_price' | 'price_mode' | 'show_rating' | 'rating_mode' | 'show_notes'>,
  location: { apple_place_id: string | null; address: string | null; latitude: number | null; longitude: number | null },
  name: string,
  fields: CustomListFields,
) {
  const parsedPriceManual = fields.priceManual?.trim() ? parseFloat(fields.priceManual) : null;
  const parsedRatingManual = fields.ratingManual?.trim() ? parseFloat(fields.ratingManual) : null;
  return {
    name: name.trim(),
    ...(list.show_location ? location : { apple_place_id: null, address: null, latitude: null, longitude: null }),
    type_ids: fields.typeIds,
    price_level: list.show_price && list.price_mode === 'dollar' ? fields.priceLevel ?? null : null,
    price_manual:
      list.show_price && list.price_mode === 'manual' && parsedPriceManual != null && !Number.isNaN(parsedPriceManual)
        ? parsedPriceManual
        : null,
    rating: list.show_rating && list.rating_mode !== 'manual' ? fields.rating ?? null : null,
    rating_manual:
      list.show_rating && list.rating_mode === 'manual' && parsedRatingManual != null && !Number.isNaN(parsedRatingManual)
        ? parsedRatingManual
        : null,
    notes: list.show_notes ? fields.notes?.trim() || null : null,
    status_id: fields.statusId,
  };
}

export async function saveCustomListItem(
  userId: string,
  list: CustomList,
  item: ItemBasics,
  fields: CustomListFields,
): Promise<SaveResult> {
  try {
    const duplicate = await isDuplicateCustomListItem(list.id, {
      name: item.name,
      latitude: list.show_location ? item.latitude : null,
      longitude: list.show_location ? item.longitude : null,
      applePlaceId: list.show_location ? item.picked?.applePlaceId : null,
    });
    if (duplicate) return { status: 'duplicate' };

    const location = locationColumns(item.picked ?? null, null, {
      address: item.address,
      latitude: item.latitude,
      longitude: item.longitude,
    });
    const payload = customListItemPayload(list, location, item.name, fields);
    const { data, error } = await supabase
      .from('custom_list_items')
      .insert({ ...payload, list_id: list.id, user_id: userId })
      .select()
      .single();
    if (error) throw error;

    // Warm Apple's details for the saved place so it shows on the map now.
    if (payload.apple_place_id) void resolveApplePlaces([payload.apple_place_id]);
    if (list.show_photos && fields.photos?.length) await uploadCustomListPhotos(userId, data.id, fields.photos);
    return { status: 'saved', id: data.id };
  } catch (error) {
    return { status: 'error', error };
  }
}

// ---------------------------------------------------------------------------
// Shared lists
// ---------------------------------------------------------------------------

export interface SharedListFields {
  status: 'to_go' | 'went_to';
  priceLevel?: number | null;
  notes?: string | null;
}

/**
 * Only a member of the shared list can add to it - enforced by row-level
 * security on shared_list_items (is_shared_list_member + added_by = you).
 */
export async function saveSharedListItem(
  userId: string,
  listId: string,
  item: ItemBasics,
  fields: SharedListFields,
): Promise<SaveResult> {
  try {
    const duplicate = await isDuplicateSharedItem(listId, {
      name: item.name,
      latitude: item.latitude,
      longitude: item.longitude,
      applePlaceId: item.picked?.applePlaceId,
    });
    if (duplicate) return { status: 'duplicate' };

    const location = locationColumns(item.picked ?? null, null, {
      address: item.address,
      latitude: item.latitude,
      longitude: item.longitude,
    });
    const { data, error } = await supabase
      .from('shared_list_items')
      .insert({
        list_id: listId,
        added_by: userId,
        name: item.name.trim(),
        // Apple-backed places store only their Apple ID (see locationColumns).
        ...location,
        status: fields.status,
        price_level: fields.priceLevel ?? null,
        notes: fields.notes?.trim() || null,
        visited_at: fields.status === 'went_to' ? new Date().toISOString() : null,
      })
      .select('id')
      .single();
    if (error) throw error;

    if (location.apple_place_id) void resolveApplePlaces([location.apple_place_id]);
    return { status: 'saved', id: data.id };
  } catch (error) {
    return { status: 'error', error };
  }
}
