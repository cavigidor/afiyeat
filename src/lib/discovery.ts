import { supabase } from '@/integrations/supabase/client';
import { withApplePlaceDetails } from '@/lib/appleMaps';
import { distanceMiles } from '@/lib/geo';
import type { ExplorePlace } from '@/components/explore/ExplorePlaceCard';
import type { ExploreList } from '@/components/explore/ExploreListCard';
import {
  classifyPlace,
  PLACE_CATEGORY_IDS,
  type PlaceCategoryId,
  type PlaceClassification,
} from '@/lib/placeClassification';

export type { PlaceCategoryId } from '@/lib/placeClassification';

/**
 * Discovery data shared by Home and Explore: the community's places and
 * lists, the place categories they're grouped into, and the (simple,
 * honest) ranking Home uses until real personalisation exists.
 *
 * Every surface that shows Food / Coffee / Drinks - Home's tiles, Explore's
 * chips, list, map and "Most visited" rail - goes through
 * placesForSelection(), so they can't disagree.
 */

export type ExploreMode = 'friends' | 'all';

/** A place in discovery, with the category decision made once. */
export interface DiscoveryPlace extends ExplorePlace {
  /** People who have been (contributor_count) are recommendations; these only want to go. */
  saved_count: number;
  /** My Restaurants types the viewer is allowed to see. */
  type_names: string[];
  classification: PlaceClassification;
}

type RpcError = { code?: string; message: string } | null;
type UntypedRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }>;
// get_discovery_places isn't in the generated (Lovable-owned) types until
// its migration is applied and the types are regenerated.
const untypedRpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc.bind(supabase) as unknown as UntypedRpc)(fn, args);

/** PostgREST / Postgres "no such function": the migration isn't applied yet. */
export function isMissingFunctionError(error: RpcError): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    /could not find the function|function .* does not exist/i.test(error.message)
  );
}

type RawPlace = ExplorePlace & { saved_count?: number | string | null; type_names?: string[] | null };

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

/** Classify a raw row (from either RPC) into a DiscoveryPlace. */
export function toDiscoveryPlace(raw: RawPlace): DiscoveryPlace {
  const type_names = (raw.type_names ?? []).filter((t): t is string => !!t);
  return {
    ...raw,
    contributor_count: num(raw.contributor_count),
    rating_count: num(raw.rating_count),
    saved_count: num(raw.saved_count),
    type_names,
    // Every row comes from My Restaurants today (see the migration); when
    // custom-list places join (after CP2) they pass 'custom_list' and list
    // titles here instead.
    classification: classifyPlace({
      name: raw.name,
      venueCategory: raw.category,
      placeTypes: type_names,
      collection: 'restaurants',
    }),
  };
}

/**
 * One card per place. Rows are already grouped by Apple ID (then legacy
 * id, then name+address) on the server; this only guards against the
 * same id arriving twice. It never merges by name.
 */
export function dedupePlaces<T extends { place_id: string }>(places: T[]): T[] {
  const seen = new Set<string>();
  return places.filter((p) => (seen.has(p.place_id) ? false : (seen.add(p.place_id), true)));
}

async function fetchRawPlaces(mode: ExploreMode): Promise<RawPlace[]> {
  const result = await untypedRpc('get_discovery_places', { p_mode: mode });
  if (!result.error) return (result.data || []) as RawPlace[];
  if (!isMissingFunctionError(result.error)) throw result.error;
  // Migration not applied yet: today's function (visits only, no types).
  const { data, error } = await supabase.rpc('get_explore_places', { p_mode: mode });
  if (error) throw error;
  return (data || []) as RawPlace[];
}

/** Places for Home and Explore: visits, plus visible want-to-go saves. */
export async function fetchDiscoveryPlaces(mode: ExploreMode): Promise<DiscoveryPlace[]> {
  const places = dedupePlaces(await fetchRawPlaces(mode));
  // Apple-saved places whose short-lived details have expired come back
  // without an address or pin; look those up again (batched, cached).
  const filled = await withApplePlaceDetails(
    places.map((p) => (p.latitude == null || !p.address ? p : { ...p, apple_place_id: null })),
  );
  return filled.map((p, i) =>
    toDiscoveryPlace({
      ...p,
      apple_place_id: places[i].apple_place_id ?? null,
      name: p.name || places[i].name,
    }),
  );
}

/** Custom lists people are building (privacy, blocks and moderation applied server-side). */
export async function fetchExploreLists(mode: ExploreMode): Promise<ExploreList[]> {
  const { data, error } = await supabase.rpc('get_explore_lists', { p_mode: mode });
  if (error) throw error;
  return (data || []) as ExploreList[];
}

/** Query keys shared by Home and Explore so both read one cache entry. */
export const exploreKeys = {
  places: (mode: ExploreMode) => ['discovery-places', mode] as const,
  lists: (mode: ExploreMode) => ['explore-lists', mode] as const,
};

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type DiscoveryCategoryId = PlaceCategoryId | 'events' | 'activities';

export interface DiscoveryCategory {
  id: DiscoveryCategoryId;
  label: string;
  /** Plural noun for sentences ("Cafés the most people have been to"). */
  noun: string;
  emoji: string;
  /** What powers it: saved places, or Ticketmaster events. */
  source: 'places' | 'events' | 'none';
  /**
   * Hidden until there's real data behind it. Activities has no source yet
   * (no saved activities, no provider), and an empty category would be a
   * fake feature - flip this once one exists.
   */
  enabled: boolean;
}

/** Category rail on Home and Explore, in display order. Add new ones here. */
export const DISCOVERY_CATEGORIES: DiscoveryCategory[] = [
  { id: 'food', label: 'Food & Restaurants', noun: 'Restaurants', emoji: '🍽️', source: 'places', enabled: true },
  { id: 'coffee', label: 'Coffee & Cafés', noun: 'Cafés', emoji: '☕', source: 'places', enabled: true },
  { id: 'drinks', label: 'Bars & Drinks', noun: 'Bars', emoji: '🍸', source: 'places', enabled: true },
  { id: 'events', label: 'Events', noun: 'Events', emoji: '🎟️', source: 'events', enabled: true },
  { id: 'activities', label: 'Activities', noun: 'Activities', emoji: '🧭', source: 'none', enabled: false },
];

export const ENABLED_CATEGORIES = DISCOVERY_CATEGORIES.filter((c) => c.enabled);

export function isEnabledCategory(id: string | null | undefined): id is DiscoveryCategoryId {
  return !!id && ENABLED_CATEGORIES.some((c) => c.id === id);
}

/**
 * What Explore can be showing: one category, or 'all' - every place
 * regardless of category. 'all' is Explore's own overview (and where
 * Home's mixed-category Popular row leads); it isn't a category, so it
 * isn't one of Home's tiles.
 */
export type ExploreSelection = DiscoveryCategoryId | 'all';
export const ALL_PLACES_PATH = '/explore?c=all';

/** Explore, opened on a category. */
export function exploreCategoryPath(id: DiscoveryCategoryId): string {
  return `/explore?c=${id}`;
}

export function categoryById(id: DiscoveryCategoryId): DiscoveryCategory {
  return DISCOVERY_CATEGORIES.find((c) => c.id === id)!;
}

export function isPlaceCategory(id: string | null | undefined): id is PlaceCategoryId {
  return !!id && (PLACE_CATEGORY_IDS as readonly string[]).includes(id);
}

/** Pin for a place we can't put in a category (never assumed to be food). */
export const UNCATEGORIZED_EMOJI = '📍';

export function emojiForCategory(id: PlaceCategoryId | null): string {
  return id ? categoryById(id).emoji : UNCATEGORIZED_EMOJI;
}

/**
 * Emoji for a bare category string (search results, circle feed). Pass
 * 'restaurants' for My Restaurants rows so a hand-typed place keeps 🍽️.
 */
export function emojiForPlace(category: string | null | undefined, collection?: 'restaurants'): string {
  return emojiForCategory(classifyPlace({ venueCategory: category, collection }).primary);
}

/** The main category of a discovery place (or any place with a category string). */
export function primaryCategoryOf(place: ExplorePlace & { classification?: PlaceClassification }): PlaceCategoryId | null {
  return (place.classification ?? classifyPlace({ name: place.name, venueCategory: place.category, collection: 'restaurants' })).primary;
}

export const isVisited = (p: ExplorePlace) => num(p.contributor_count) > 0;

/**
 * Order within a category, most useful first:
 *   1. places people have been to before want-to-go-only places
 *      (a save is not a recommendation),
 *   2. how certain the match is (venue category, then type, name, ...),
 *   3. how many people have been, 4. average rating,
 *   5. how many want to go, 6. name, 7. id (fully deterministic).
 */
export function compareInCategory(category: PlaceCategoryId | 'all') {
  return (a: DiscoveryPlace, b: DiscoveryPlace): number => {
    const tierOf = (p: DiscoveryPlace) =>
      category === 'all'
        ? p.classification.primary
          ? (p.classification.tier[p.classification.primary] ?? 9)
          : 9
        : (p.classification.tier[category] ?? 9);
    return (
      Number(isVisited(b)) - Number(isVisited(a)) ||
      tierOf(a) - tierOf(b) ||
      num(b.contributor_count) - num(a.contributor_count) ||
      num(b.avg_rating) - num(a.avg_rating) ||
      num(b.saved_count) - num(a.saved_count) ||
      a.name.localeCompare(b.name) ||
      a.place_id.localeCompare(b.place_id)
    );
  };
}

/**
 * The places for one Explore selection - the single rule Home's tiles,
 * Explore's chips, list, map and rail all use. 'all' is every place,
 * including ones that fit no category.
 */
export function placesForSelection(places: DiscoveryPlace[], selection: ExploreSelection): DiscoveryPlace[] {
  if (selection !== 'all' && !isPlaceCategory(selection)) return [];
  const inSelection =
    selection === 'all' ? places : places.filter((p) => p.classification.categories.includes(selection));
  return [...dedupePlaces(inSelection)].sort(compareInCategory(selection));
}

/** Explore selection a Home tile / deep link opens (the inverse of exploreCategoryPath). */
export function selectionFromSearch(search: string): ExploreSelection | null {
  const c = new URLSearchParams(search).get('c');
  if (c === 'all') return 'all';
  return isEnabledCategory(c) ? c : null;
}

/** "837 W Fulton Market, Chicago, IL 60607, United States" -> "Chicago". */
export function areaFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  // Apple's format is "street, city, region postcode, country"; shorter
  // addresses drop the country or region, leaving the city second.
  if (parts.length >= 4) return parts[parts.length - 3];
  if (parts.length >= 2) return parts[1];
  return null;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export interface Origin {
  lat: number;
  lng: number;
}

export interface RankedPlaces<T extends ExplorePlace = ExplorePlace> {
  /**
   * How the list was built - decides the section title, so the label
   * always says what the data actually is ("near you" only when it is).
   */
  strategy: 'nearby' | 'everywhere';
  places: T[];
}

const NEARBY_RADIUS_MILES = 30;
const MIN_NEARBY = 3;

/**
 * Popular places for Home: the places the most different people have been
 * to, best-rated first among ties, leaving out places you've saved
 * yourself. Near you when location was already allowed and there are
 * enough places around; everywhere otherwise.
 *
 * This is the seam for personalisation: a future ranker can take the same
 * input (plus the user's own saves and interests) and return the same
 * shape, and Home doesn't change.
 */
export function rankPopularPlaces<T extends ExplorePlace>(
  places: T[],
  opts: { origin: Origin | null; excludeAppleIds: Set<string>; excludeNames: Set<string>; limit?: number },
): RankedPlaces<T> {
  const limit = opts.limit ?? 10;
  // Popular means been-to: want-to-go saves aren't recommendations.
  const candidates = places.filter(
    (p) =>
      num(p.contributor_count) > 0 &&
      !(p.apple_place_id && opts.excludeAppleIds.has(p.apple_place_id)) &&
      !opts.excludeNames.has(p.name.trim().toLowerCase()),
  );
  const byPopularity = (a: T, b: T) =>
    num(b.contributor_count) - num(a.contributor_count) ||
    num(b.avg_rating) - num(a.avg_rating) ||
    a.name.localeCompare(b.name);

  if (opts.origin) {
    const origin = opts.origin;
    const nearby = candidates.filter(
      (p) =>
        p.latitude != null &&
        p.longitude != null &&
        distanceMiles(origin, { lat: p.latitude, lng: p.longitude }) <= NEARBY_RADIUS_MILES,
    );
    if (nearby.length >= MIN_NEARBY) {
      return { strategy: 'nearby', places: nearby.sort(byPopularity).slice(0, limit) };
    }
  }
  return { strategy: 'everywhere', places: [...candidates].sort(byPopularity).slice(0, limit) };
}
