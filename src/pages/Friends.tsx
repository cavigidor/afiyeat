import { useState, useEffect, useRef, useMemo } from 'react';
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
import { Search, UserPlus, UserMinus, Loader2, Users, Sparkles, Map, Check, Clock, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useMapCenter } from '@/hooks/useMapCenter';
import { SharedLists } from '@/components/shared/SharedLists';

interface Profile {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

interface SuggestedProfile extends Profile {
  follower_count: number;
}

interface Follow {
  id: string;
  following_id: string;
  profiles: Profile;
}

export default function Friends() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [topTab, setTopTab] = useState<'discover' | 'shared'>('discover');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [following, setFollowing] = useState<Profile[]>([]);
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [userRestaurants, setUserRestaurants] = useState<any[]>([]);
  const [friendStatusFilter, setFriendStatusFilter] = useState<'went_to' | 'to_go'>('went_to');
  const [friendListSearch, setFriendListSearch] = useState('');
  const [friendSelectedFolder, setFriendSelectedFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [suggested, setSuggested] = useState<SuggestedProfile[]>([]);
  const [suggestedLoading, setSuggestedLoading] = useState(true);
  const [mapboxToken, setMapboxToken] = useState<string | null>(null);
  const [mapboxLoading, setMapboxLoading] = useState(true);
  const [focusedRestaurantId, setFocusedRestaurantId] = useState<string | null>(null);
  const mapFlyToRef = useRef<((lat: number, lng: number, restaurantId: string) => void) | null>(null);

  // Stable array reference across re-renders (as long as the underlying data
  // hasn't changed) - the map component below re-inits its GPS lookup and
  // rebuilds the whole Mapbox map whenever this reference changes, so an
  // inline .filter() here was causing a full map rebuild on every render.
  const statusFilteredRestaurants = useMemo(
    () => userRestaurants.filter((r) => r.status === friendStatusFilter),
    [userRestaurants, friendStatusFilter],
  );

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

  const fetchSuggested = async () => {
    if (!user) return;
    setSuggestedLoading(true);

    // Get public profiles
    const { data: publicProfiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, user_id, username, display_name, avatar_url')
      .eq('is_private', false)
      .neq('user_id', user.id);

    if (profilesError) {
      console.error('Error fetching public profiles:', profilesError);
      setSuggestedLoading(false);
      return;
    }

    if (!publicProfiles || publicProfiles.length === 0) {
      setSuggested([]);
      setSuggestedLoading(false);
      return;
    }

    // Get follower counts for each profile
    const profilesWithCounts: SuggestedProfile[] = [];
    for (const profile of publicProfiles) {
      const { count } = await supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('following_id', profile.user_id)
        .eq('status', 'accepted');

      profilesWithCounts.push({
        ...profile,
        follower_count: count || 0,
      });
    }

    // Sort by follower count and take top 5
    profilesWithCounts.sort((a, b) => b.follower_count - a.follower_count);
    setSuggested(profilesWithCounts.slice(0, 5));
    setSuggestedLoading(false);
  };

  useEffect(() => {
    if (user) {
      fetchFollowing();
      fetchSuggested();
    }
  }, [user]);

  useEffect(() => {
    const fetchMapboxToken = async () => {
      if (mapboxToken) return;
      
      try {
        const { data, error } = await supabase.functions.invoke('get-mapbox-token');
        if (!error && data?.token) {
          setMapboxToken(data.token);
        }
      } catch (err) {
        console.error('Error fetching Mapbox token:', err);
      } finally {
        setMapboxLoading(false);
      }
    };
    fetchMapboxToken();
  }, [mapboxToken]);

  const handleRestaurantClick = (restaurant: any) => {
    if (restaurant.latitude && restaurant.longitude) {
      setFocusedRestaurantId(restaurant.id);
      setTimeout(() => {
        mapFlyToRef.current?.(restaurant.latitude!, restaurant.longitude!, restaurant.id);
      }, 100);
    }
  };

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

      <main className="container py-4 sm:py-8 px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl sm:text-3xl font-bold mb-4 sm:mb-6">Friends</h1>

        <Tabs value={topTab} onValueChange={(v) => setTopTab(v as 'discover' | 'shared')}>
          <TabsList className="mb-4 sm:mb-6">
            <TabsTrigger value="discover">Discover</TabsTrigger>
            <TabsTrigger value="shared">Shared Lists</TabsTrigger>
          </TabsList>

          <TabsContent value="discover">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8">
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

            {/* Suggested Users */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  Suggested
                </CardTitle>
              </CardHeader>
              <CardContent>
                {suggestedLoading ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : suggested.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">
                    No suggestions available
                  </p>
                ) : (
                  <div className="space-y-2">
                    {suggested
                      .filter((p) => !isFollowing(p.user_id))
                      .map((profile) => (
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
                              <p className="text-xs text-muted-foreground">
                                {profile.follower_count} follower{profile.follower_count !== 1 ? 's' : ''}
                              </p>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => {
                              handleFollow(profile.user_id);
                              setSuggested((prev) =>
                                prev.filter((p) => p.user_id !== profile.user_id)
                              );
                            }}
                          >
                            <UserPlus className="h-4 w-4" />
                          </Button>
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
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 sm:mb-6">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 sm:h-12 sm:w-12">
                      <AvatarImage src={selectedUser.avatar_url || ''} />
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {(selectedUser.username || selectedUser.display_name || 'U')[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h2 className="text-lg sm:text-xl font-bold">
                        {selectedUser.display_name || selectedUser.username}'s List
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {userRestaurants.length} restaurants
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
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
                  <div className="space-y-6">
                    {/* Status Filter Tabs */}
                    <Tabs value={friendStatusFilter} onValueChange={(v) => setFriendStatusFilter(v as 'went_to' | 'to_go')}>
                      <TabsList className="w-full sm:w-auto">
                        <TabsTrigger value="went_to" className="flex-1 sm:flex-initial gap-1.5">
                          <Check className="h-3.5 w-3.5" />
                          Been There
                        </TabsTrigger>
                        <TabsTrigger value="to_go" className="flex-1 sm:flex-initial gap-1.5">
                          <Clock className="h-3.5 w-3.5" />
                          To Go
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>

                    {/* Map */}
                    <Card className="overflow-hidden">
                      <CardContent className="p-0">
                        <div className="h-[300px] lg:h-[400px] relative">
                          {mapboxLoading ? (
                            <div className="flex items-center justify-center h-full">
                              <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            </div>
                          ) : mapboxToken ? (
                            <FriendsMapComponent
                              token={mapboxToken}
                              restaurants={statusFilteredRestaurants}
                              focusedRestaurantId={focusedRestaurantId}
                              onFocusRestaurant={setFocusedRestaurantId}
                              flyToRef={mapFlyToRef}
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                              <Map className="h-12 w-12 mb-4 opacity-50" />
                              <p>Map unavailable</p>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Restaurant list with search + folder filter */}
                    {(() => {
                      const statusFiltered = statusFilteredRestaurants;
                      const folderMap: Record<string, { name: string; color: string }> = {};
                      statusFiltered.forEach(r => {
                        if (r.folder?.name && !folderMap[r.folder.name]) {
                          folderMap[r.folder.name] = r.folder;
                        }
                      });
                      const folderOptions = Object.values(folderMap);

                      const tokens = friendListSearch.toLowerCase().split(/\s+/).filter(Boolean);
                      const filtered = statusFiltered.filter(r => {
                        if (friendSelectedFolder && r.folder?.name !== friendSelectedFolder) return false;
                        if (tokens.length === 0) return true;
                        const hay = `${r.name} ${r.address || ''} ${r.notes || ''} ${r.folder?.name || ''}`.toLowerCase();
                        return tokens.every(t => hay.includes(t));
                      });

                      return (
                        <div className="space-y-3">
                          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                            <div className="relative flex-1">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                placeholder="Search this list..."
                                value={friendListSearch}
                                onChange={(e) => setFriendListSearch(e.target.value)}
                                className="pl-9"
                              />
                            </div>
                            {(friendListSearch || friendSelectedFolder) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => { setFriendListSearch(''); setFriendSelectedFolder(null); }}
                              >
                                <X className="h-4 w-4 mr-1" /> Clear
                              </Button>
                            )}
                          </div>

                          {folderOptions.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              <Badge
                                variant={friendSelectedFolder === null ? 'default' : 'outline'}
                                className="cursor-pointer"
                                onClick={() => setFriendSelectedFolder(null)}
                              >
                                All
                              </Badge>
                              {folderOptions.map((f) => (
                                <Badge
                                  key={f.name}
                                  variant={friendSelectedFolder === f.name ? 'default' : 'outline'}
                                  className="cursor-pointer"
                                  style={
                                    friendSelectedFolder === f.name
                                      ? { backgroundColor: f.color, borderColor: f.color }
                                      : undefined
                                  }
                                  onClick={() =>
                                    setFriendSelectedFolder(friendSelectedFolder === f.name ? null : f.name)
                                  }
                                >
                                  {f.name}
                                </Badge>
                              ))}
                            </div>
                          )}

                          {filtered.length === 0 ? (
                            <div className="text-center py-8 bg-card rounded-xl">
                              <p className="text-muted-foreground">
                                {statusFiltered.length === 0
                                  ? friendStatusFilter === 'went_to'
                                    ? "No restaurants marked as Been There yet"
                                    : "No restaurants on their To Go list"
                                  : 'No restaurants match your filters'}
                              </p>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {filtered.map((restaurant) => (
                                <div
                                  key={restaurant.id}
                                  onClick={() => handleRestaurantClick(restaurant)}
                                  className={`cursor-pointer transition-all ${
                                    focusedRestaurantId === restaurant.id
                                      ? 'ring-2 ring-primary rounded-xl'
                                      : ''
                                  }`}
                                >
                                  <RestaurantCard restaurant={restaurant} />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
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
          </TabsContent>

          <TabsContent value="shared">
            <SharedLists following={following} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

interface FriendsMapComponentProps {
  token: string;
  restaurants: any[];
  focusedRestaurantId: string | null;
  onFocusRestaurant: (id: string | null) => void;
  flyToRef: React.MutableRefObject<((lat: number, lng: number, restaurantId: string) => void) | null>;
}

function FriendsMapComponent({ token, restaurants, focusedRestaurantId, onFocusRestaurant, flyToRef }: FriendsMapComponentProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<globalThis.Map<string, any>>(new globalThis.Map());
  const { center } = useMapCenter(restaurants);
  // Capture only the center available at mount time; the map is created once
  // and subsequently panned (see the effect below) rather than rebuilt every
  // time `center` resolves to a new value (e.g. once GPS comes back).
  const initialCenterRef = useRef(center);

  useEffect(() => {
    if (!mapContainer.current || !token) return;
    let cancelled = false;

    const loadMapbox = async () => {
      const mapboxgl = (await import('mapbox-gl')).default;
      await import('mapbox-gl/dist/mapbox-gl.css');
      if (cancelled) return;

      mapboxgl.accessToken = token;

      mapRef.current = new mapboxgl.Map({
        container: mapContainer.current!,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [initialCenterRef.current.lng, initialCenterRef.current.lat],
        zoom: 11,
      });

      mapRef.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

      flyToRef.current = (lat: number, lng: number, restaurantId: string) => {
        if (mapRef.current) {
          mapRef.current.flyTo({
            center: [lng, lat],
            zoom: 16,
            duration: 1500,
            essential: true
          });
          const marker = markersRef.current.get(restaurantId);
          if (marker) {
            marker.togglePopup();
          }
        }
      };
    };

    loadMapbox();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      flyToRef.current = null;
    };
    // Intentionally created once per token - see the pan effect below.
  }, [token, flyToRef]);

  // Pan the already-created map when the resolved center changes (e.g. GPS
  // resolves shortly after mount) instead of tearing the whole map down.
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.easeTo({ center: [center.lng, center.lat], duration: 600 });
  }, [center]);

  useEffect(() => {
    if (!mapRef.current) return;

    markersRef.current.forEach(marker => marker.remove());
    markersRef.current.clear();

    const restaurantsWithLocation = restaurants.filter(r => r.latitude && r.longitude);

    if (restaurantsWithLocation.length === 0) return;

    const loadMarkers = async () => {
      const mapboxgl = (await import('mapbox-gl')).default;

      restaurantsWithLocation.forEach(restaurant => {
        const isFocused = focusedRestaurantId === restaurant.id;
        
        const el = document.createElement('div');
        el.className = `flex items-center justify-center shadow-lg cursor-pointer transition-all duration-300 ${
          isFocused 
            ? 'w-12 h-12 bg-primary rounded-full ring-4 ring-primary/30 scale-110' 
            : 'w-8 h-8 bg-primary rounded-full hover:scale-110'
        }`;
        el.innerHTML = `<svg class="${isFocused ? 'w-6 h-6' : 'w-4 h-4'}" fill="white" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;

        const safeName = restaurant.name.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeAddress = restaurant.address?.replace(/</g, '&lt;').replace(/>/g, '&gt;') || '';

        const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
          <div class="p-2">
            <h3 class="font-semibold">${safeName}</h3>
            ${safeAddress ? `<p class="text-sm text-gray-600">${safeAddress}</p>` : ''}
            ${restaurant.rating ? `<p class="text-sm">Rating: ${restaurant.rating}/10</p>` : ''}
          </div>
        `);

        const marker = new mapboxgl.Marker(el)
          .setLngLat([restaurant.longitude!, restaurant.latitude!])
          .setPopup(popup)
          .addTo(mapRef.current);

        el.addEventListener('click', () => {
          onFocusRestaurant(restaurant.id);
        });

        markersRef.current.set(restaurant.id, marker);
      });

      if (restaurantsWithLocation.length > 0 && !focusedRestaurantId) {
        const bounds = new mapboxgl.LngLatBounds();
        restaurantsWithLocation.forEach(r => {
          bounds.extend([r.longitude!, r.latitude!]);
        });
        mapRef.current.fitBounds(bounds, { padding: 50, maxZoom: 14 });
      }
    };

    const checkMap = setInterval(() => {
      if (mapRef.current?.loaded()) {
        clearInterval(checkMap);
        loadMarkers();
      }
    }, 100);

    return () => clearInterval(checkMap);
  }, [restaurants, focusedRestaurantId, onFocusRestaurant]);

  return <div ref={mapContainer} className="w-full h-full" />;
}
