import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface FollowingProfile {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_emoji: string;
  avatar_color: string;
}

async function fetchFollowingFor(userId: string): Promise<FollowingProfile[]> {
  const { data: followsData, error: followsError } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', userId)
    .eq('status', 'accepted');

  if (followsError) throw followsError;
  if (!followsData || followsData.length === 0) return [];

  const followingIds = followsData.map((f) => f.following_id);
  const { data: profilesData, error: profilesError } = await supabase
    .from('profiles')
    .select('id, user_id, username, display_name, avatar_emoji, avatar_color')
    .in('user_id', followingIds);

  if (profilesError) throw profilesError;
  return profilesData || [];
}

// Same query shape (and cache key) as Friends.tsx's own inline
// following-list fetch - pulled out here so newer call sites (My Lists'
// shared-list creation, converting a private list to shared) don't need a
// third copy of it, without touching Friends.tsx's already-working one.
export function useFollowing(userId: string | undefined) {
  return useQuery({
    queryKey: ['following', userId],
    queryFn: () => fetchFollowingFor(userId!),
    enabled: !!userId,
  });
}
