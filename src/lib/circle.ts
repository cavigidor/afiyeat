import { supabase } from '@/integrations/supabase/client';

/**
 * "From your circle" on Home: what people you follow have recently saved
 * or started. Only discovery-worthy events - a place saved or visited, a
 * list started - never follows, avatar changes and the like.
 *
 * Read straight from the tables under the existing row-level security:
 * you can read the places and lists of people you follow (and of public
 * profiles), and blocked accounts' rows are hidden by the restrictive
 * block policies. No new backend.
 */

export interface CircleActor {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_emoji: string | null;
  avatar_color: string | null;
}

export type CircleEvent =
  | {
      kind: 'place';
      id: string;
      at: string;
      actor: CircleActor;
      placeName: string;
      category: string | null;
      /** 'to_go' = wants to try, 'went_to' = has been. */
      status: string;
      rating: number | null;
    }
  | {
      kind: 'list';
      id: string;
      at: string;
      actor: CircleActor;
      listId: string;
      listName: string;
      listIcon: string | null;
    };

export interface CircleActivity {
  followingCount: number;
  events: CircleEvent[];
}

const WINDOW_DAYS = 30;
const MAX_EVENTS = 6;

export async function fetchFollowingIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', userId)
    .eq('status', 'accepted');
  if (error) throw error;
  return (data || []).map((f) => f.following_id);
}

export async function fetchCircleActivity(userId: string): Promise<CircleActivity> {
  const followingIds = await fetchFollowingIds(userId);
  if (followingIds.length === 0) return { followingCount: 0, events: [] };

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [placesRes, listsRes, profilesRes] = await Promise.all([
    supabase
      .from('restaurants')
      .select('id, user_id, name, category, status, rating, created_at')
      .in('user_id', followingIds)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('custom_lists')
      .select('id, user_id, name, icon, created_at')
      .in('user_id', followingIds)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('profiles')
      .select('user_id, username, display_name, avatar_emoji, avatar_color')
      .in('user_id', followingIds),
  ]);
  if (placesRes.error) throw placesRes.error;
  if (listsRes.error) throw listsRes.error;

  const actors = new Map<string, CircleActor>();
  (profilesRes.data || []).forEach((p) => actors.set(p.user_id, p));

  const events: CircleEvent[] = [];
  for (const r of placesRes.data || []) {
    const actor = actors.get(r.user_id);
    if (!actor || !r.name) continue;
    events.push({
      kind: 'place',
      id: `place:${r.id}`,
      at: r.created_at,
      actor,
      placeName: r.name,
      category: r.category,
      status: r.status,
      rating: r.rating,
    });
  }
  for (const l of listsRes.data || []) {
    const actor = actors.get(l.user_id);
    if (!actor) continue;
    events.push({
      kind: 'list',
      id: `list:${l.id}`,
      at: l.created_at,
      actor,
      listId: l.id,
      listName: l.name,
      listIcon: l.icon,
    });
  }

  // One person saving ten places in an afternoon shouldn't fill the whole
  // section: at most two events per person, newest first.
  events.sort((a, b) => b.at.localeCompare(a.at));
  const perActor = new Map<string, number>();
  const picked = events.filter((e) => {
    const n = perActor.get(e.actor.user_id) ?? 0;
    if (n >= 2) return false;
    perActor.set(e.actor.user_id, n + 1);
    return true;
  });

  return { followingCount: followingIds.length, events: picked.slice(0, MAX_EVENTS) };
}

export function actorName(actor: CircleActor): string {
  return actor.display_name || actor.username || 'Someone';
}

/** "just now", "5m", "3h", "2d", "Oct 3". */
export function timeAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
