import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Search as SearchIcon, Loader2, Lock, Clock, UserPlus, UserCheck, Users } from 'lucide-react';
import { toast } from 'sonner';

interface Profile {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  is_private: boolean;
}

interface FollowStatus {
  [userId: string]: 'none' | 'following' | 'pending';
}

export default function Search() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [followStatus, setFollowStatus] = useState<FollowStatus>({});
  const [processingFollow, setProcessingFollow] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  const handleSearch = async () => {
    if (!searchQuery.trim() || !user) return;

    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .or(`username.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`)
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

  const getFollowButton = (profile: Profile) => {
    const status = followStatus[profile.user_id] || 'none';
    const isProcessing = processingFollow === profile.user_id;

    if (isProcessing) {
      return (
        <Button disabled size="sm">
          <Loader2 className="h-4 w-4 animate-spin" />
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

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container py-8 max-w-2xl">
        <h1 className="text-3xl font-bold mb-6">Find People</h1>

        <div className="flex gap-2 mb-6">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by username or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="pl-10"
            />
          </div>
          <Button onClick={handleSearch} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
          </Button>
        </div>

        <div className="space-y-3">
          {searchResults.length === 0 && searchQuery && !loading && (
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={profile.avatar_url || ''} />
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {(profile.username || profile.display_name || 'U')[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{profile.display_name || profile.username}</p>
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
                  </div>
                  {getFollowButton(profile)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
