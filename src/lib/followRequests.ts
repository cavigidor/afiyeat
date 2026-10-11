import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface RequestProfile {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_emoji: string;
  avatar_color: string;
}

export interface PendingRequest {
  id: string;
  follower_id: string;
  created_at: string;
  profile: RequestProfile;
}

/** Follow requests waiting for this user to accept or decline. */
export async function fetchPendingRequestsFor(userId: string): Promise<PendingRequest[]> {
  const { data, error } = await supabase
    .from('follows')
    .select('id, follower_id, created_at')
    .eq('following_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw error;
  if (!data || data.length === 0) return [];

  const followerIds = data.map((f) => f.follower_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, user_id, username, display_name, avatar_emoji, avatar_color')
    .in('user_id', followerIds);

  return data
    .map((follow) => ({
      id: follow.id,
      follower_id: follow.follower_id,
      created_at: follow.created_at,
      profile: profiles?.find((p) => p.user_id === follow.follower_id) as RequestProfile,
    }))
    .filter((r) => r.profile);
}

/**
 * Pending follow requests, shared by the Activity tab badge, the Activity
 * screen and Profile (same cache key, so accepting in one place updates
 * the others).
 */
export function usePendingRequests(userId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['pending-requests', userId],
    queryFn: () => fetchPendingRequestsFor(userId!),
    enabled: !!userId && enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export async function acceptFollowRequest(requestId: string) {
  return supabase.from('follows').update({ status: 'accepted' }).eq('id', requestId);
}

export async function declineFollowRequest(requestId: string) {
  return supabase.from('follows').delete().eq('id', requestId);
}
