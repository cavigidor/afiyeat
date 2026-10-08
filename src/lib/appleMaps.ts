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

// ---------------------------------------------------------------------
// Details (resolve)
// ---------------------------------------------------------------------

// In-memory copy for this session, so the same place isn't asked for twice
// while the app is open. Cleared with the rest of the cache on account
// change (see clearApplePlaceMemory) and naturally on relaunch.
const memory = new Map<string, { place: ApplePlace; until: number }>();
const MEMORY_TTL_MS = 30 * 60 * 1000;
const inFlight = new Map<string, Promise<void>>();

export function clearApplePlaceMemory(): void {
  memory.clear();
}

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
