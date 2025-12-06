import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Search as SearchIcon, UserPlus, UserMinus, Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';

interface Profile {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
}

export default function Search() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [following, setFollowing] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  const fetchFollowing = async () => {
    if (!user) return;

    const { data } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', user.id);

    setFollowing(data?.map((f) => f.following_id) || []);
  };

  useEffect(() => {
    if (user) {
      fetchFollowing();
    }
  }, [user]);

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
      console.error('Error searching:', error);
    } else {
      setResults(data || []);
    }
    setLoading(false);
  };

  const handleFollow = async (profileUserId: string) => {
    if (!user) return;

    const { error } = await supabase.from('follows').insert({
      follower_id: user.id,
      following_id: profileUserId,
    });

    if (error) {
      toast.error('Failed to follow user');
    } else {
      toast.success('Now following!');
      setFollowing([...following, profileUserId]);
    }
  };

  const handleUnfollow = async (profileUserId: string) => {
    if (!user) return;

    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', user.id)
      .eq('following_id', profileUserId);

    if (error) {
      toast.error('Failed to unfollow');
    } else {
      toast.success('Unfollowed');
      setFollowing(following.filter((id) => id !== profileUserId));
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

        <div className="flex gap-2 mb-8">
          <Input
            placeholder="Search by username or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="text-lg"
          />
          <Button onClick={handleSearch} disabled={loading} size="lg">
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <SearchIcon className="h-5 w-5" />
            )}
          </Button>
        </div>

        {results.length === 0 && !loading && searchQuery && (
          <div className="text-center py-12 bg-card rounded-xl">
            <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">No users found for "{searchQuery}"</p>
          </div>
        )}

        <div className="space-y-4">
          {results.map((profile) => (
            <Card key={profile.id}>
              <CardContent className="p-4 flex items-center gap-4">
                <Avatar className="h-14 w-14">
                  <AvatarImage src={profile.avatar_url || ''} />
                  <AvatarFallback className="bg-primary text-primary-foreground text-lg">
                    {(profile.username || profile.display_name || 'U')[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">
                    {profile.display_name || profile.username}
                  </h3>
                  {profile.username && (
                    <p className="text-muted-foreground">@{profile.username}</p>
                  )}
                  {profile.bio && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {profile.bio}
                    </p>
                  )}
                </div>
                {following.includes(profile.user_id) ? (
                  <Button
                    variant="outline"
                    onClick={() => handleUnfollow(profile.user_id)}
                  >
                    <UserMinus className="h-4 w-4 mr-2" />
                    Unfollow
                  </Button>
                ) : (
                  <Button onClick={() => handleFollow(profile.user_id)}>
                    <UserPlus className="h-4 w-4 mr-2" />
                    Follow
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
