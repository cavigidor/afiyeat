import { supabase } from '@/integrations/supabase/client';
import type { ExploreList } from '@/components/explore/ExploreListCard';
import type { ListVisibility } from '@/lib/listVisibility';

/**
 * Community lists: what people are building, as Explore, Lists -> Discover,
 * Home and Search show them. One data source for all four -
 * get_explore_lists - which already applies visibility, blocks,
 * moderation and anonymity on the server.
 */

// These functions are newer than the generated Supabase types (which are
// Lovable's to regenerate), so they're called untyped, like passport.ts does.
const untypedRpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;

export type CommunityMode = 'all' | 'friends';
export const COMMUNITY_PAGE_SIZE = 30;

export interface CommunityListPage {
  lists: ExploreList[];
  nextOffset: number | null;
}

export async function fetchCommunityLists(opts: {
  mode: CommunityMode;
  query?: string;
  offset?: number;
  limit?: number;
}): Promise<CommunityListPage> {
  const limit = opts.limit ?? COMMUNITY_PAGE_SIZE;
  const offset = opts.offset ?? 0;
  const { data, error } = await untypedRpc('get_explore_lists', {
    p_mode: opts.mode,
    p_query: opts.query?.trim() || null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  const lists = (data || []) as ExploreList[];
  return { lists, nextOffset: lists.length === limit ? offset + limit : null };
}

/** Stable identity for a card - the list id, or the anonymous token. */
export function communityListKey(list: Pick<ExploreList, 'list_id' | 'discovery_token'>): string {
  return list.list_id ?? `anon:${list.discovery_token}`;
}

/** Where a card opens: the owner's list page, or the anonymous view. */
export function communityListPath(list: Pick<ExploreList, 'list_id' | 'user_id' | 'is_anonymous' | 'discovery_token'>): string | null {
  if (list.is_anonymous) return list.discovery_token ? `/lists/discover/${list.discovery_token}` : null;
  return list.user_id && list.list_id ? `/u/${list.user_id}/lists/${list.list_id}` : null;
}

/** Drops repeats (paging can overlap when lists change between pages). */
export function uniqueLists(lists: ExploreList[]): ExploreList[] {
  const seen = new Set<string>();
  return lists.filter((l) => {
    const key = communityListKey(l);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Anonymous list view
// ---------------------------------------------------------------------------

/** Exactly what the server returns for an anonymous list - nothing else exists client-side. */
export interface DiscoverableList {
  token: string;
  title: string;
  icon: string | null;
  rating_mode: 'scale_10' | 'stars_5' | 'manual' | null;
  statuses: string[];
  types: { name: string; icon: string | null; color: string | null }[];
  items: { name: string; status: string | null; types: string[]; rating: number | null }[];
  is_owner: boolean;
  /** Only on the owner's preview. */
  visibility?: ListVisibility;
}

export async function fetchDiscoverableList(token: string): Promise<DiscoverableList | null> {
  const { data, error } = await untypedRpc('get_discoverable_list', { p_token: token });
  if (error) {
    // A malformed token is just "not found" to the person looking at it.
    if (error.code === '22P02') return null;
    throw error;
  }
  return (data as DiscoverableList | null) ?? null;
}

/** The owner's preview of the anonymous view, available before opting in. */
export async function fetchListDiscoveryPreview(listId: string): Promise<DiscoverableList | null> {
  const { data, error } = await untypedRpc('get_list_discovery_preview', { p_list_id: listId });
  if (error) throw error;
  return (data as DiscoverableList | null) ?? null;
}

export type AnonymousReportResult = 'reported' | 'already_reported' | 'not_found' | 'own_list';

export async function reportDiscoverableList(
  token: string,
  reason: string,
  description?: string,
): Promise<AnonymousReportResult> {
  const { data, error } = await untypedRpc('report_discoverable_list', {
    p_token: token,
    p_reason: reason,
    p_description: description?.trim() || null,
  });
  if (error) throw error;
  return data as AnonymousReportResult;
}
