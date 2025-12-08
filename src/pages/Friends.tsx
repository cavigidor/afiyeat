import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RestaurantCard } from '@/components/restaurants/RestaurantCard';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Search, UserPlus, UserMinus, Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';

interface Profile {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

interface Follow {
  id: string;
  following_id: string;
  profiles: Profile;
}

export default function Friends() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [following, setFollowing] = useState<Profile[]>([]);
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [userRestaurants, setUserRestaurants] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  const fetchFollowing = async () => {
    if (!user) return;

    // Get follows with accepted status
    const { data: followsData, error: followsError } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', user.id)
      .eq('status', 'accepted');

    if (followsError) {
      console.error('Error fetching follows:', followsError);
      return;
    }

    if (!followsData || followsData.length === 0) {
      setFollowing([]);
      return;
    }

    // Get profiles for followed users
    const followingIds = followsData.map((f) => f.following_id);
    const { data: profilesData, error: profilesError } = await supabase
      .from('profiles')
      .select('id, user_id, username, display_name, avatar_url')
      .in('user_id', followingIds);

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError);
    } else {
      setFollowing(profilesData || []);
    }
  };

  useEffect(() => {
    if (user) {
      fetchFollowing();
    }
  }, [user]);

  const handleSearch = async () => {
    if (!searchQuery.trim() || !user) return;

    setSearchLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .or(`username.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`)
      .neq('user_id', user.id)
      .limit(10);

    if (error) {
      console.error('Error searching users:', error);
    } else {
      setSearchResults(data || []);
    }
    setSearchLoading(false);
  };

  const handleFollow = async (profileUserId: string) => {
    if (!user) return;

    const { error } = await supabase.from('follows').insert({
      follower_id: user.id,
      following_id: profileUserId,
    });

    if (error) {
      if (error.code === '23505') {
        toast.error('You are already following this user');
      } else {
        toast.error('Failed to follow user');
      }
    } else {
      toast.success('Now following!');
      fetchFollowing();
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
      toast.error('Failed to unfollow user');
    } else {
      toast.success('Unfollowed');
      fetchFollowing();
      if (selectedUser?.user_id === profileUserId) {
        setSelectedUser(null);
        setUserRestaurants([]);
      }
    }
  };

  const isFollowing = (profileUserId: string) => {
    return following.some((f) => f.user_id === profileUserId);
  };

  const viewUserRestaurants = async (profile: Profile) => {
    setSelectedUser(profile);
    setLoading(true);

    const { data, error } = await supabase
      .from('restaurants')
      .select(`
        *,
        folder:folders(name, color),
        images:restaurant_images(image_url)
      `)
      .eq('user_id', profile.user_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching user restaurants:', error);
    } else {
      setUserRestaurants(data || []);
    }
    setLoading(false);
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

      <main className="container py-8">
        <h1 className="text-3xl font-bold mb-6">Friends</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Search and Following List */}
          <div className="lg:col-span-1 space-y-6">
            {/* Search */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Find Friends</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    placeholder="Search by username..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  />
                  <Button onClick={handleSearch} disabled={searchLoading}>
                    {searchLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>

                {searchResults.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {searchResults.map((profile) => (
                      <div
                        key={profile.id}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-muted"
                      >
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={profile.avatar_url || ''} />
                            <AvatarFallback className="bg-primary text-primary-foreground">
                              {(profile.username || profile.display_name || 'U')[0].toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">
                              {profile.display_name || profile.username}
                            </p>
                            {profile.username && (
                              <p className="text-sm text-muted-foreground">
                                @{profile.username}
                              </p>
                            )}
                          </div>
                        </div>
                        {isFollowing(profile.user_id) ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleUnfollow(profile.user_id)}
                          >
                            <UserMinus className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => handleFollow(profile.user_id)}
                          >
                            <UserPlus className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Following List */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Following ({following.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {following.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">
                    You're not following anyone yet
                  </p>
                ) : (
                  <div className="space-y-2">
                    {following.map((profile) => (
                      <button
                        key={profile.id}
                        onClick={() => viewUserRestaurants(profile)}
                        className={`w-full flex items-center gap-3 p-2 rounded-lg transition-colors ${
                          selectedUser?.id === profile.id
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-muted'
                        }`}
                      >
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={profile.avatar_url || ''} />
                          <AvatarFallback
                            className={
                              selectedUser?.id === profile.id
                                ? 'bg-primary-foreground text-primary'
                                : 'bg-primary text-primary-foreground'
                            }
                          >
                            {(profile.username || profile.display_name || 'U')[0].toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="text-left">
                          <p className="font-medium">
                            {profile.display_name || profile.username}
                          </p>
                          {profile.username && (
                            <p
                              className={`text-sm ${
                                selectedUser?.id === profile.id
                                  ? 'text-primary-foreground/70'
                                  : 'text-muted-foreground'
                              }`}
                            >
                              @{profile.username}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* User's Restaurants */}
          <div className="lg:col-span-2">
            {selectedUser ? (
              <>
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={selectedUser.avatar_url || ''} />
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {(selectedUser.username || selectedUser.display_name || 'U')[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h2 className="text-xl font-bold">
                        {selectedUser.display_name || selectedUser.username}'s List
                      </h2>
                      <p className="text-muted-foreground">
                        {userRestaurants.length} restaurants
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => handleUnfollow(selectedUser.user_id)}
                  >
                    <UserMinus className="h-4 w-4 mr-2" />
                    Unfollow
                  </Button>
                </div>

                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : userRestaurants.length === 0 ? (
                  <div className="text-center py-12 bg-card rounded-xl">
                    <p className="text-muted-foreground">
                      This user hasn't added any restaurants yet
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {userRestaurants.map((restaurant) => (
                      <RestaurantCard key={restaurant.id} restaurant={restaurant} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12 bg-card rounded-xl">
                <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium mb-2">Select a friend</h3>
                <p className="text-muted-foreground">
                  Click on someone you follow to see their restaurant list
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
