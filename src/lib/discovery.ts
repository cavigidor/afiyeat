import { supabase } from '@/integrations/supabase/client';
import { withApplePlaceDetails } from '@/lib/appleMaps';
import { distanceMiles } from '@/lib/geo';
import type { ExplorePlace } from '@/components/explore/ExplorePlaceCard';
import type { ExploreList } from '@/components/explore/ExploreListCard';

/**
 * Discovery data shared by Home and Explore: the community's places and
 * lists, the place categories they're grouped into, and the (simple,
 * honest) ranking Home uses until real personalisation exists.
 */

export type ExploreMode = 'friends' | 'all';

/** Places people have been to, merged across everyone who saved them. */
export async function fetchExplorePlaces(mode: ExploreMode): Promise<ExplorePlace[]> {
  const { data, error } = await supabase.rpc('get_explore_places', { p_mode: mode });
  if (error) throw error;
  const places = (data || []) as ExplorePlace[];
  // Apple-saved places whose short-lived details have expired come back
  // without an address or pin; look those up again (batched, cached).
  const filled = await withApplePlaceDetails(
    places.map((p) => (p.latitude == null || !p.address ? p : { ...p, apple_place_id: null })),
  );
  return filled.map((p, i) => ({
    ...p,
    apple_place_id: places[i].apple_place_id ?? null,
    name: p.name || places[i].name,
  }));
}

/** Custom lists people are building (privacy, blocks and moderation applied server-side). */
export async function fetchExploreLists(mode: ExploreMode): Promise<ExploreList[]> {
  const { data, error } = await supabase.rpc('get_explore_lists', { p_mode: mode });
  if (error) throw error;
  return (data || []) as ExploreList[];
}

/** Query keys shared by Home and Explore so both read one cache entry. */
export const exploreKeys = {
  places: (mode: ExploreMode) => ['explore-places', mode] as const,
  lists: (mode: ExploreMode) => ['explore-lists', mode] as const,
};

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type PlaceCategoryId = 'food' | 'coffee' | 'drinks';
export type DiscoveryCategoryId = PlaceCategoryId | 'events' | 'activities';

export interface DiscoveryCategory {
  id: DiscoveryCategoryId;
  label: string;
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
  { id: 'food', label: 'Food', emoji: '🍽️', source: 'places', enabled: true },
  { id: 'coffee', label: 'Coffee', emoji: '☕', source: 'places', enabled: true },
  { id: 'drinks', label: 'Drinks', emoji: '🍸', source: 'places', enabled: true },
  { id: 'events', label: 'Events', emoji: '🎟️', source: 'events', enabled: true },
  { id: 'activities', label: 'Activities', emoji: '🧭', source: 'none', enabled: false },
];

export const ENABLED_CATEGORIES = DISCOVERY_CATEGORIES.filter((c) => c.enabled);

export function isEnabledCategory(id: string | null | undefined): id is DiscoveryCategoryId {
  return !!id && ENABLED_CATEGORIES.some((c) => c.id === id);
}

/** Explore, opened on a category. */
export function exploreCategoryPath(id: DiscoveryCategoryId): string {
  return `/explore?c=${id}`;
}

export function categoryById(id: DiscoveryCategoryId): DiscoveryCategory {
  return DISCOVERY_CATEGORIES.find((c) => c.id === id)!;
}

// Apple's POI categories (what new saves store), plus words from the older
// Mapbox-era categories still on some rows. Everything else saved to the
// restaurants table - including places with no category, typed in by hand
// - counts as Food, since that table is the food list.
const COFFEE_PATTERN = /\b(cafe|café|coffee|tea ?house|tea ?room)\b/i;
const DRINKS_PATTERN = /\b(nightlife|bar|pub|brewery|winery|distillery|wine|beer|cocktail|taproom|tavern|lounge)\b/i;

/** Which place category a saved place's category string belongs to. */
export function placeCategoryOf(category: string | null | undefined): PlaceCategoryId {
  if (!category) return 'food';
  // Apple sends CamelCase ids ("FoodMarket"); older rows use snake_case.
  const words = category.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  if (COFFEE_PATTERN.test(words)) return 'coffee';
  if (DRINKS_PATTERN.test(words)) return 'drinks';
  return 'food';
}

export function emojiForPlace(category: string | null | undefined): string {
  return categoryById(placeCategoryOf(category)).emoji;
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

export interface RankedPlaces {
  /**
   * How the list was built - decides the section title, so the label
   * always says what the data actually is ("near you" only when it is).
   */
  strategy: 'nearby' | 'everywhere';
  places: ExplorePlace[];
}

const NEARBY_RADIUS_MILES = 30;
const MIN_NEARBY = 3;

const toNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

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
export function rankPopularPlaces(
  places: ExplorePlace[],
  opts: { origin: Origin | null; excludeAppleIds: Set<string>; excludeNames: Set<string>; limit?: number },
): RankedPlaces {
  const limit = opts.limit ?? 10;
  const candidates = places.filter(
    (p) =>
      !(p.apple_place_id && opts.excludeAppleIds.has(p.apple_place_id)) &&
      !opts.excludeNames.has(p.name.trim().toLowerCase()),
  );
  const byPopularity = (a: ExplorePlace, b: ExplorePlace) =>
    toNum(b.contributor_count) - toNum(a.contributor_count) ||
    toNum(b.avg_rating) - toNum(a.avg_rating) ||
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
