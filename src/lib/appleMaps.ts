import { supabase } from '@/integrations/supabase/client';
import { getEdgeFunctionErrorMessage } from '@/lib/edgeFunctionError';

/**
 * Apple Maps for the app: place search, place details and MapKit JS.
 *
 * Everything goes through the apple-maps edge function, which holds the
 * Apple key. Apple lets us keep a place's ID permanently but its details
 * (name, address, coordinates) only temporarily, so details come from
 * resolveApplePlaces() - backed by a short-lived server cache - rather
 * than being stored on saved items.
 */

export interface ApplePlace {
  id: string;
  name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  countryCode: string | null;
}

async function invoke<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke('apple-maps', { body });
  if (error) throw new Error(await getEdgeFunctionErrorMessage(error, fallback));
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}

// ---------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------

export async function searchApplePlaces(
  query: string,
  options: { latitude?: number | null; longitude?: number | null; kind?: 'food' | 'any' } = {},
): Promise<ApplePlace[]> {
  const result = await invoke<{ results: ApplePlace[] }>(
    {
      action: 'search',
      query,
      latitude: options.latitude ?? undefined,
      longitude: options.longitude ?? undefined,
      kind: options.kind ?? 'food',
    },
    "Couldn't search places right now.",
  );
  return Array.isArray(result.results) ? result.results : [];
}

let warmedUp = false;

/**
 * Wakes the search function before the user types, so the first real
 * search doesn't also pay for a cold start. Sends an empty query, which
 * the function answers without calling Apple (no quota used).
 */
export function warmUpPlaceSearch(): void {
  if (warmedUp) return;
  warmedUp = true;
  void supabase.functions.invoke('apple-maps', { body: { action: 'search', query: '' } }).catch(() => {
    warmedUp = false;
  });
}

// ---------------------------------------------------------------------
// Details (resolve)
// ---------------------------------------------------------------------

// In-memory copy for this session, so the same place isn't asked for twice
// while the app is open. Place details aren't private, so it isn't tied to
// the signed-in account; it simply empties on relaunch.
const memory = new Map<string, { place: ApplePlace; until: number }>();
const MEMORY_TTL_MS = 30 * 60 * 1000;
const inFlight = new Map<string, Promise<void>>();

/**
 * Details for a set of Apple place IDs. Unknown or unavailable IDs are
 * simply absent from the result; callers fall back to the item's own
 * label.
 */
export async function resolveApplePlaces(ids: readonly (string | null | undefined)[]): Promise<Record<string, ApplePlace>> {
  const now = Date.now();
  const unique = Array.from(new Set(ids.filter((id): id is string => !!id)));
  const out: Record<string, ApplePlace> = {};
  const needed: string[] = [];

  for (const id of unique) {
    const hit = memory.get(id);
    if (hit && hit.until > now) out[id] = hit.place;
    else needed.push(id);
  }

  // Fast path: details another visitor already fetched are in the shared
  // short-lived cache, readable directly (expired rows are hidden by RLS).
  if (needed.length > 0) {
    const { data: cached } = await supabase
      .from('place_cache')
      .select('apple_place_id, name, address, latitude, longitude, category, country_code')
      .in('apple_place_id', needed);
    const until = Date.now() + MEMORY_TTL_MS;
    for (const row of cached ?? []) {
      const place: ApplePlace = {
        id: row.apple_place_id,
        name: row.name,
        address: row.address,
        latitude: row.latitude,
        longitude: row.longitude,
        category: row.category,
        countryCode: row.country_code,
      };
      memory.set(place.id, { place, until });
      out[place.id] = place;
    }
    for (let i = needed.length - 1; i >= 0; i--) {
      if (out[needed[i]]) needed.splice(i, 1);
    }
  }

  // Join requests already in flight for the same IDs instead of repeating them.
  const waits: Promise<void>[] = [];
  const toRequest: string[] = [];
  for (const id of needed) {
    const pending = inFlight.get(id);
    if (pending) waits.push(pending);
    else toRequest.push(id);
  }

  for (let i = 0; i < toRequest.length; i += 200) {
    const chunk = toRequest.slice(i, i + 200);
    const request = invoke<{ places: Record<string, ApplePlace> }>(
      { action: 'resolve', ids: chunk },
      "Couldn't load place details.",
    )
      .then((result) => {
        const until = Date.now() + MEMORY_TTL_MS;
        for (const [id, place] of Object.entries(result.places ?? {})) {
          memory.set(id, { place, until });
        }
      })
      .catch((err) => {
        console.error('resolveApplePlaces failed:', err);
      })
      .finally(() => {
        for (const id of chunk) inFlight.delete(id);
      });
    for (const id of chunk) inFlight.set(id, request);
    waits.push(request);
  }

  await Promise.all(waits);
  for (const id of needed) {
    const hit = memory.get(id);
    if (hit) out[id] = hit.place;
  }
  return out;
}

/** The location fields of any saved item (restaurant, list item, shared item). */
export interface PlaceFields {
  apple_place_id?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Fills in address and coordinates for items saved from Apple Maps, which
 * store only the Apple place ID. Anything the user entered themselves
 * (a typed address, a pin they placed) wins over Apple's details. The
 * item's own name - the user's label for the place - is never replaced.
 */
/** Which displayed fields came from Apple rather than from the saved row. */
export interface AppleFilled {
  address: boolean;
  pin: boolean;
}

export async function withApplePlaceDetails<T extends PlaceFields>(
  rows: T[],
): Promise<(T & { appleFilled?: AppleFilled })[]> {
  const ids = rows.map((r) => r.apple_place_id).filter((id): id is string => !!id);
  if (ids.length === 0) return rows;
  const places = await resolveApplePlaces(ids);
  return rows.map((row) => {
    const place = row.apple_place_id ? places[row.apple_place_id] : undefined;
    if (!place) return row;
    const hasOwnPin = row.latitude != null && row.longitude != null;
    const fillAddress = !row.address && !!place.address;
    const fillPin = !hasOwnPin && place.latitude != null && place.longitude != null;
    return {
      ...row,
      address: fillAddress ? place.address : row.address,
      latitude: fillPin ? place.latitude : row.latitude,
      longitude: fillPin ? place.longitude : row.longitude,
      appleFilled: { address: fillAddress, pin: fillPin },
    };
  });
}

/**
 * Location columns to write back when editing an item that was shown with
 * Apple's details filled in. Apple-supplied values the user left alone are
 * not written to the row (they'd become permanent copies); anything the
 * user changed is theirs and is saved.
 */
export function placeColumnsForEdit(
  row: PlaceFields & { appleFilled?: AppleFilled },
  form: { address?: string | null; latitude?: number | null; longitude?: number | null },
): { address: string | null; latitude: number | null; longitude: number | null } {
  const typed = form.address?.trim() || null;
  const latitude = form.latitude ?? null;
  const longitude = form.longitude ?? null;
  if (!row.apple_place_id || !row.appleFilled) return { address: typed, latitude, longitude };

  const addressUnchanged = typed === (row.address?.trim() || null);
  const pinUnchanged = latitude === (row.latitude ?? null) && longitude === (row.longitude ?? null);
  const dropPin = row.appleFilled.pin && pinUnchanged;
  return {
    address: row.appleFilled.address && addressUnchanged ? null : typed,
    latitude: dropPin ? null : latitude,
    longitude: dropPin ? null : longitude,
  };
}

/** Location columns shared by restaurants, list items and shared items. */
export interface LocationColumns {
  apple_place_id: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** What a place picked from search contributes to a save. */
export interface PickedPlace {
  applePlaceId: string | null;
  /** The address Apple showed when it was picked (not stored). */
  appleAddress: string | null;
}

/**
 * The location columns to store for a new or edited item.
 *
 * For a place picked from Apple Maps, only the Apple place ID is kept -
 * Apple's address and coordinates are shown from the short-lived cache
 * instead (see withApplePlaceDetails). If the user typed over the address,
 * what they typed is theirs and is kept. Manually entered places store
 * whatever the user entered.
 */
export function placeColumnsForSave(
  picked: PickedPlace | null,
  form: { address?: string | null; latitude?: number | null; longitude?: number | null },
): LocationColumns {
  const typedAddress = form.address?.trim() || null;
  if (picked?.applePlaceId) {
    const editedAddress =
      typedAddress && typedAddress !== (picked.appleAddress ?? '').trim() ? typedAddress : null;
    return {
      apple_place_id: picked.applePlaceId,
      address: editedAddress,
      latitude: null,
      longitude: null,
    };
  }
  return {
    apple_place_id: null,
    address: typedAddress,
    latitude: form.latitude ?? null,
    longitude: form.longitude ?? null,
  };
}

/**
 * Location columns for any add/edit form:
 *  - a place picked from search in this session -> Apple ID only
 *  - editing an existing item, nothing new picked -> keep its Apple ID and
 *    write back only what the user changed (placeColumnsForEdit)
 *  - otherwise -> whatever the user typed
 */
export function locationColumns(
  picked: PickedPlace | null,
  editRow: (PlaceFields & { appleFilled?: AppleFilled }) | null | undefined,
  form: { address?: string | null; latitude?: number | null; longitude?: number | null },
): LocationColumns {
  if (picked?.applePlaceId) return placeColumnsForSave(picked, form);
  if (editRow) {
    return { apple_place_id: editRow.apple_place_id ?? null, ...placeColumnsForEdit(editRow, form) };
  }
  return placeColumnsForSave(null, form);
}

// ---------------------------------------------------------------------
// MapKit JS
// ---------------------------------------------------------------------

// MapKit JS ships without bundled types; this file is the only place that
// touches the global directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MapKit = any;

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mapkit?: any;
    __afiyeatMapKitLoaded?: () => void;
  }
}

const MAPKIT_SRC = 'https://cdn.apple-mapkit.com/mk/6/mapkit.core.js';
const MAPKIT_LIBRARIES = ['map', 'annotations'];
let mapkitPromise: Promise<MapKit> | null = null;

async function fetchMapKitToken(): Promise<string> {
  const { token } = await invoke<{ token: string; expiresAt: number }>(
    { action: 'mapkit-token' },
    "Couldn't load the map.",
  );
  return token;
}

/**
 * Loads and initialises MapKit JS once per page. MapKit calls the
 * authorization callback again by itself whenever its token expires, so
 * long-lived sessions keep working.
 */
export function loadMapKit(): Promise<MapKit> {
  if (mapkitPromise) return mapkitPromise;

  mapkitPromise = new Promise<MapKit>((resolve, reject) => {
    const finish = async () => {
      const mk = window.mapkit;
      if (!mk) {
        reject(new Error('MapKit JS failed to load.'));
        return;
      }
      try {
        mk.init({
          authorizationCallback: (done: (token: string) => void) => {
            fetchMapKitToken()
              .then(done)
              .catch((err) => console.error('MapKit token failed:', err));
          },
          language: 'en',
        });
        await mk.load(MAPKIT_LIBRARIES);
        resolve(mk);
      } catch (err) {
        reject(err);
      }
    };

    if (window.mapkit?.Map) {
      void finish();
      return;
    }

    window.__afiyeatMapKitLoaded = () => void finish();
    const script = document.createElement('script');
    script.src = MAPKIT_SRC;
    script.crossOrigin = 'anonymous';
    script.async = true;
    script.dataset.callback = '__afiyeatMapKitLoaded';
    script.dataset.libraries = MAPKIT_LIBRARIES.join(',');
    script.onerror = () => reject(new Error("Couldn't reach Apple Maps."));
    document.head.appendChild(script);
  }).catch((err) => {
    // Let a later attempt try again (e.g. after the connection comes back).
    mapkitPromise = null;
    throw err;
  });

  return mapkitPromise;
}
