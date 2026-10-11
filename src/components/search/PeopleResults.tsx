import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AnimalAvatar } from '@/components/shared/AnimalAvatar';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Lock, Clock, UserPlus, UserCheck, Users } from 'lucide-react';
import { toast } from 'sonner';
import { hapticSuccess } from '@/lib/haptics';
import { offerPushAfterFollow } from '@/lib/pushPrompt';
import { Spinner } from '@/components/ui/spinner';

interface Profile {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_emoji: string;
  avatar_color: string;
  bio: string | null;
  is_private: boolean;
}

interface FollowStatus {
  [userId: string]: 'none' | 'following' | 'pending';
}

// Characters that would change the meaning of a PostgREST or() filter -
// a comma starts a new condition, parentheses group them.
function cleanTerm(q: string): string {
  return q.replace(/[,()%*\\]/g, ' ').trim();
}

/**
 * People results for the search screen: find someone by name or
 * username and follow them (or request to, for a private account) right
 * from the row. This is the old Find People screen's logic, unchanged
 * apart from searching as you type instead of on a button.
 */
export function PeopleResults({ query }: { query: string }) {
  const { user } = useAuth();
  const searchQuery = query;
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [followStatus, setFollowStatus] = useState<FollowStatus>({});
  const [processingFollow, setProcessingFollow] = useState<string | null>(null);

  const handleSearch = async () => {
    const term = cleanTerm(searchQuery);
    if (term.length < 2 || !user) {
      setSearchResults([]);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .or(`username.ilike.%${term}%,display_name.ilike.%${term}%`)
      .neq('user_id', user.id)
      .limit(20);

    if (error) {
      toast.error('Search failed');
      console.error('Search error:', error);
    } else {
      setSearchResults(data || []);
      
      // Fetch follow status for all results
      if (data && data.length > 0) {
        const userIds = data.map(p => p.user_id);
        const { data: followsData } = await supabase
          .from('follows')
          .select('following_id, status')
          .eq('follower_id', user.id)
          .in('following_id', userIds);

        const statusMap: FollowStatus = {};
        userIds.forEach(id => {
          const follow = followsData?.find(f => f.following_id === id);
          if (follow) {
            statusMap[id] = follow.status === 'accepted' ? 'following' : 'pending';
          } else {
            statusMap[id] = 'none';
          }
        });
        setFollowStatus(statusMap);
      }
    }
    setLoading(false);
  };

  const handleFollow = async (profile: Profile) => {
    if (!user) return;
    
    setProcessingFollow(profile.user_id);
    
    // Determine the status based on whether the profile is private
    const status = profile.is_private ? 'pending' : 'accepted';
    
    const { error } = await supabase
      .from('follows')
      .insert({
        follower_id: user.id,
        following_id: profile.user_id,
        status,
      });

    if (error) {
      if (error.code === '23505') {
        toast.error('Already following or request pending');
      } else {
        toast.error('Failed to follow');
        console.error('Follow error:', error);
      }
    } else {
      setFollowStatus(prev => ({
        ...prev,
        [profile.user_id]: status === 'accepted' ? 'following' : 'pending',
      }));
      
      if (profile.is_private) {
        toast.success('Follow request sent!');
      } else {
        toast.success(`Now following ${profile.display_name || profile.username}!`);
      }
      void hapticSuccess();
      void offerPushAfterFollow({ pending: !!profile.is_private });
    }
    setProcessingFollow(null);
  };

  const handleUnfollow = async (profileUserId: string) => {
    if (!user) return;
    
    setProcessingFollow(profileUserId);
    
    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', user.id)
      .eq('following_id', profileUserId);

    if (error) {
      toast.error('Failed to unfollow');
      console.error('Unfollow error:', error);
    } else {
      setFollowStatus(prev => ({
        ...prev,
        [profileUserId]: 'none',
      }));
      toast.success('Unfollowed');
    }
    setProcessingFollow(null);
  };

  const handleCancelRequest = async (profileUserId: string) => {
    if (!user) return;
    
    setProcessingFollow(profileUserId);
    
    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', user.id)
      .eq('following_id', profileUserId);

    if (error) {
      toast.error('Failed to cancel request');
    } else {
      setFollowStatus(prev => ({
        ...prev,
        [profileUserId]: 'none',
      }));
      toast.success('Request cancelled');
    }
    setProcessingFollow(null);
  };

  // Search as you type, after a short pause.
  useEffect(() => {
    const id = setTimeout(() => void handleSearch(), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, user?.id]);

  const getFollowButton = (profile: Profile) => {
    const status = followStatus[profile.user_id] || 'none';
    const isProcessing = processingFollow === profile.user_id;

    if (isProcessing) {
      return (
        <Button disabled size="sm">
          <Spinner className="h-4 w-4 animate-spin" />
        </Button>
      );
    }

    switch (status) {
      case 'following':
        return (
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => handleUnfollow(profile.user_id)}
          >
            <UserCheck className="h-4 w-4 mr-1" />
            Following
          </Button>
        );
      case 'pending':
        return (
          <Button 
            variant="secondary" 
            size="sm"
            onClick={() => handleCancelRequest(profile.user_id)}
          >
            <Clock className="h-4 w-4 mr-1" />
            Requested
          </Button>
        );
      default:
        return (
          <Button 
            size="sm"
            onClick={() => handleFollow(profile)}
          >
            <UserPlus className="h-4 w-4 mr-1" />
            {profile.is_private ? 'Request' : 'Follow'}
          </Button>
        );
    }
  };

  return (
    <div className="space-y-3">
      {loading && searchResults.length === 0 && (
        <div className="flex justify-center py-8">
          <Spinner className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {searchResults.length === 0 && cleanTerm(searchQuery).length >= 2 && !loading && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
            No users found matching "{searchQuery}"
          </CardContent>
        </Card>
      )}

      {searchResults.map((profile) => (
        <Card key={profile.id}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <Link to={`/u/${profile.user_id}`} className="flex min-w-0 items-center gap-4">
                <AnimalAvatar
                  emoji={profile.avatar_emoji}
                  color={profile.avatar_color}
                  className="h-12 w-12"
                  emojiClassName="text-2xl"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold">{profile.display_name || profile.username}</p>
                    {profile.is_private && (
                      <Badge variant="secondary" className="text-xs">
                        <Lock className="h-3 w-3 mr-1" />
                        Private
                      </Badge>
                    )}
                  </div>
                  {profile.username && (
                    <p className="text-sm text-muted-foreground">@{profile.username}</p>
                  )}
                  {profile.bio && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-1">{profile.bio}</p>
                  )}
                </div>
              </Link>
              <div className="shrink-0">{getFollowButton(profile)}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
