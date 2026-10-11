import { supabase } from '@/integrations/supabase/client';

/**
 * The Activity screen's feed: things that happened to you or your shared
 * lists, from data that already exists - no notifications table, no
 * read/unread state (so no badge for these, only for follow requests).
 *
 *   - someone started following you
 *   - your shared-list partner added something
 *   - your shared-list partner commented on an item
 *
 * Follow requests are handled separately (lib/followRequests.ts) because
 * they need an answer, not just a glance.
 */

export interface ActivityActor {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_emoji: string | null;
  avatar_color: string | null;
}

export type ActivityItem =
  | { kind: 'follower'; id: string; at: string; actor: ActivityActor }
  | {
      kind: 'shared_add';
      id: string;
      at: string;
      actor: ActivityActor;
      listId: string;
      listName: string;
      itemName: string;
    }
  | {
      kind: 'shared_comment';
      id: string;
      at: string;
      actor: ActivityActor;
      listId: string;
      listName: string;
      itemName: string;
      comment: string;
    };

const WINDOW_DAYS = 30;
const MAX_ITEMS = 40;

export async function fetchActivity(userId: string): Promise<ActivityItem[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [followersRes, listsRes] = await Promise.all([
    supabase
      .from('follows')
      .select('id, follower_id, created_at')
      .eq('following_id', userId)
      .eq('status', 'accepted')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20),
    // Row-level security already limits this to lists you're a member of.
    supabase.from('shared_lists').select('id, name'),
  ]);
  if (followersRes.error) throw followersRes.error;
  if (listsRes.error) throw listsRes.error;

  const lists = new Map((listsRes.data || []).map((l) => [l.id, l.name]));
  const listIds = Array.from(lists.keys());

  const [itemsRes, commentsRes] = listIds.length
    ? await Promise.all([
        supabase
          .from('shared_list_items')
          .select('id, list_id, name, added_by, created_at')
          .in('list_id', listIds)
          .neq('added_by', userId)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('shared_list_item_comments')
          .select('id, list_id, item_id, user_id, comment, created_at')
          .in('list_id', listIds)
          .neq('user_id', userId)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(20),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (itemsRes.error) throw itemsRes.error;
  if (commentsRes.error) throw commentsRes.error;

  const items = itemsRes.data || [];
  const comments = commentsRes.data || [];

  // Names of commented-on items that weren't in the recent-adds batch.
  const itemNames = new Map(items.map((i) => [i.id, i.name]));
  const missingItemIds = Array.from(new Set(comments.map((c) => c.item_id))).filter((id) => !itemNames.has(id));
  if (missingItemIds.length) {
    const { data } = await supabase.from('shared_list_items').select('id, name').in('id', missingItemIds);
    (data || []).forEach((i) => itemNames.set(i.id, i.name));
  }

  const actorIds = Array.from(
    new Set([
      ...(followersRes.data || []).map((f) => f.follower_id),
      ...items.map((i) => i.added_by),
      ...comments.map((c) => c.user_id),
    ]),
  );
  const actors = new Map<string, ActivityActor>();
  if (actorIds.length) {
    const { data } = await supabase
      .from('profiles')
      .select('user_id, username, display_name, avatar_emoji, avatar_color')
      .in('user_id', actorIds);
    (data || []).forEach((p) => actors.set(p.user_id, p));
  }

  const feed: ActivityItem[] = [];
  for (const f of followersRes.data || []) {
    const actor = actors.get(f.follower_id);
    if (actor) feed.push({ kind: 'follower', id: `f:${f.id}`, at: f.created_at, actor });
  }
  for (const i of items) {
    const actor = actors.get(i.added_by);
    if (!actor) continue;
    feed.push({
      kind: 'shared_add',
      id: `i:${i.id}`,
      at: i.created_at,
      actor,
      listId: i.list_id,
      listName: lists.get(i.list_id) ?? 'a shared list',
      itemName: i.name,
    });
  }
  for (const c of comments) {
    const actor = actors.get(c.user_id);
    if (!actor) continue;
    feed.push({
      kind: 'shared_comment',
      id: `c:${c.id}`,
      at: c.created_at,
      actor,
      listId: c.list_id,
      listName: lists.get(c.list_id) ?? 'a shared list',
      itemName: itemNames.get(c.item_id) ?? 'an item',
      comment: c.comment,
    });
  }

  return feed.sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_ITEMS);
}
