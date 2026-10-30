import { supabase } from '@/integrations/supabase/client';
import type { CustomList } from '@/components/lists/CreateListDialog';
import type { ManagedListType } from '@/hooks/useListTypeManagement';
import type { ManagedListStatus } from '@/hooks/useListStatusManagement';
import { sharedListPath } from '@/lib/navigation';

/**
 * Where the universal Add Item can save to: My Restaurants, lists you own,
 * and shared lists you're a member of. Nothing else is offered - and the
 * database enforces the same rule (see the custom_list_items owner-check
 * migration and the shared_list_items membership policy).
 */
export type AddDestination =
  | { kind: 'restaurants'; key: 'restaurants'; label: string; icon: string }
  | { kind: 'custom'; key: string; label: string; icon: string; list: CustomList }
  | { kind: 'shared'; key: string; label: string; icon: string; listId: string; partnerName: string };

export const RESTAURANTS_DESTINATION: AddDestination = {
  kind: 'restaurants',
  key: 'restaurants',
  label: 'My Restaurants',
  icon: '🍽️',
};

export interface AddDestinations {
  custom: AddDestination[];
  shared: AddDestination[];
}

export async function fetchAddDestinations(userId: string): Promise<AddDestinations> {
  const [customRes, sharedRes] = await Promise.all([
    // Owned lists only - other people's lists can be readable, never writable.
    supabase.from('custom_lists').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    // Row-level security returns only lists you're a member of.
    supabase.from('shared_lists').select('id, name, user_a, user_b').order('created_at', { ascending: false }),
  ]);
  if (customRes.error) throw customRes.error;
  if (sharedRes.error) throw sharedRes.error;

  const sharedRows = (sharedRes.data || []).filter((r) => r.user_a === userId || r.user_b === userId);
  const partnerIds = Array.from(new Set(sharedRows.map((r) => (r.user_a === userId ? r.user_b : r.user_a))));
  const partners = new Map<string, string>();
  if (partnerIds.length) {
    const { data } = await supabase
      .from('profiles')
      .select('user_id, display_name, username')
      .in('user_id', partnerIds);
    (data || []).forEach((p) => partners.set(p.user_id, p.display_name || p.username || 'a friend'));
  }

  return {
    custom: ((customRes.data || []) as unknown as CustomList[]).map((list) => ({
      kind: 'custom' as const,
      key: `custom:${list.id}`,
      label: list.name,
      icon: list.icon || '📋',
      list,
    })),
    shared: sharedRows.map((r) => ({
      kind: 'shared' as const,
      key: `shared:${r.id}`,
      label: r.name,
      icon: '👥',
      listId: r.id,
      partnerName: partners.get(r.user_a === userId ? r.user_b : r.user_a) ?? 'a friend',
    })),
  };
}

/** Restaurant types (folders) - the same rows My Restaurants shows. */
export async function fetchFolders(
  userId: string,
): Promise<{ id: string; name: string; color: string; icon?: string | null }[]> {
  const { data, error } = await supabase
    .from('folders')
    .select('id, name, color, icon')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function fetchListStatuses(listId: string): Promise<ManagedListStatus[]> {
  const { data, error } = await supabase
    .from('custom_list_statuses')
    .select('*')
    .eq('list_id', listId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function fetchListTypes(listId: string): Promise<ManagedListType[]> {
  const { data, error } = await supabase
    .from('custom_list_types')
    .select('*')
    .eq('list_id', listId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Where to go to see a destination's items. */
export function destinationPath(dest: AddDestination): string {
  if (dest.kind === 'restaurants') return '/my-list';
  if (dest.kind === 'custom') return `/my-lists/${dest.list.id}`;
  return sharedListPath(dest.listId);
}

/** Whether the destination keeps a location (and so offers place search). */
export function destinationHasLocation(dest: AddDestination): boolean {
  return dest.kind !== 'custom' || dest.list.show_location;
}

// The last destination used, so a run of adds to the same list starts in
// the right place. One viewer's convenience only - kept in this browser,
// and everything works without it.
const LAST_DESTINATION_KEY = 'afiyeat:add-item:last-destination';

export function readLastDestination(): string | null {
  try {
    return localStorage.getItem(LAST_DESTINATION_KEY);
  } catch {
    return null;
  }
}

export function rememberDestination(key: string): void {
  try {
    localStorage.setItem(LAST_DESTINATION_KEY, key);
  } catch {
    // Storage unavailable (private mode etc.) - nothing to remember.
  }
}
