import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { MapPin, Star, DollarSign, Loader2, Map, List, Search, Plus, Check, Clock, Filter, TrendingUp } from 'lucide-react';
import { RestaurantCard } from '@/components/restaurants/RestaurantCard';
import { AddRestaurantDialog } from '@/components/restaurants/AddRestaurantDialog';
import { toast } from 'sonner';

interface Restaurant {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  price_level: number | null;
  status: string;
  notes: string | null;
  user_id: string;
  folder?: { name: string; color: string } | null;
  images?: { image_url: string }[];
  profile?: { display_name: string | null; username: string | null } | null;
}

interface Folder {
  id: string;
  name: string;
  color: string;
  icon: string;
}

const KEYWORD_TAGS = [
  'coffee', 'lunch', 'dinner', 'brunch', 'cheap', 'high-end', 
  'cafe', 'bar', 'pizza', 'sushi', 'italian', 'mexican', 'asian'
];

export default function Explore() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [myRestaurants, setMyRestaurants] = useState<Restaurant[]>([]);
  const [nearbyRestaurants, setNearbyRestaurants] = useState<Restaurant[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'map' | 'list'>('list');
  const [mapboxToken, setMapboxToken] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [minRating, setMinRating] = useState<string>('all');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [myPicksTab, setMyPicksTab] = useState<'to_go' | 'went_to'>('to_go');

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  const fetchData = async () => {
    if (!user) return;

    setLoading(true);
    
    // Fetch user's restaurants
    const { data: myData, error: myError } = await supabase
      .from('restaurants')
      .select(`
        *,
        folder:folders(name, color),
        images:restaurant_images(image_url)
      `)
      .eq('user_id', user.id)
      .order('rating', { ascending: false, nullsFirst: false });

    if (myError) {
      console.error('Error fetching my restaurants:', myError);
    } else {
      setMyRestaurants(myData || []);
    }

    // Fetch folders
    const { data: folderData } = await supabase
      .from('folders')
      .select('*')
      .eq('user_id', user.id);
    
    setFolders(folderData || []);

    // Fetch followed users' restaurants (sorted by rating)
    const { data: followedData, error: followedError } = await supabase
      .from('restaurants')
      .select(`
        *,
        folder:folders(name, color),
        images:restaurant_images(image_url)
      `)
      .order('rating', { ascending: false, nullsFirst: false })
      .limit(50);

    if (followedError) {
      console.error('Error fetching nearby restaurants:', followedError);
    } else {
      // Filter out current user's restaurants
      const filtered = (followedData || []).filter(r => r.user_id !== user.id);
      setNearbyRestaurants(filtered);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const toggleKeyword = (keyword: string) => {
    setSelectedKeywords(prev => 
      prev.includes(keyword) 
        ? prev.filter(k => k !== keyword)
        : [...prev, keyword]
    );
  };

  const filteredNearbyRestaurants = useMemo(() => {
    let filtered = [...nearbyRestaurants];

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(r => 
        r.name.toLowerCase().includes(query) ||
        r.address?.toLowerCase().includes(query) ||
        r.notes?.toLowerCase().includes(query) ||
        r.folder?.name.toLowerCase().includes(query)
      );
    }

    // Filter by keywords
    if (selectedKeywords.length > 0) {
      filtered = filtered.filter(r => {
        const searchText = `${r.name} ${r.address || ''} ${r.notes || ''} ${r.folder?.name || ''}`.toLowerCase();
        return selectedKeywords.some(kw => searchText.includes(kw));
      });
    }

    // Filter by rating
    if (minRating !== 'all') {
      const rating = parseInt(minRating);
      filtered = filtered.filter(r => r.rating && r.rating >= rating);
    }

    return filtered;
  }, [nearbyRestaurants, searchQuery, selectedKeywords, minRating]);

  const myToGoList = myRestaurants.filter(r => r.status === 'to_go');
  const myWentToList = myRestaurants.filter(r => r.status === 'went_to');

  const handleMarkVisited = async (restaurantId: string) => {
    const { error } = await supabase
      .from('restaurants')
      .update({ status: 'went_to', visited_at: new Date().toISOString() })
      .eq('id', restaurantId);

    if (error) {
      toast.error('Failed to update restaurant');
    } else {
      toast.success('Marked as visited!');
      fetchData();
    }
  };

  const handleDelete = async (restaurantId: string) => {
    const { error } = await supabase
      .from('restaurants')
      .delete()
      .eq('id', restaurantId);

    if (error) {
      toast.error('Failed to delete restaurant');
    } else {
      toast.success('Restaurant deleted');
      fetchData();
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

      <main className="container py-8 space-y-8">
        {/* My Picks Section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Star className="h-6 w-6 text-primary" />
              My Picks
            </h2>
            <Button onClick={() => setAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Restaurant
            </Button>
          </div>

          <Card>
            <CardContent className="p-4">
              <Tabs value={myPicksTab} onValueChange={(v) => setMyPicksTab(v as 'to_go' | 'went_to')}>
                <TabsList className="mb-4">
                  <TabsTrigger value="to_go" className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    To Go ({myToGoList.length})
                  </TabsTrigger>
                  <TabsTrigger value="went_to" className="flex items-center gap-2">
                    <Check className="h-4 w-4" />
                    Been There ({myWentToList.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="to_go">
                  {loading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : myToGoList.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No restaurants on your to-go list yet</p>
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {myToGoList.slice(0, 8).map((restaurant) => (
                        <RestaurantCard
                          key={restaurant.id}
                          restaurant={restaurant}
                          onMarkVisited={() => handleMarkVisited(restaurant.id)}
                          onDelete={() => handleDelete(restaurant.id)}
                        />
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="went_to">
                  {loading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : myWentToList.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Check className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>You haven't visited any restaurants yet</p>
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {myWentToList.slice(0, 8).map((restaurant) => (
                        <RestaurantCard
                          key={restaurant.id}
                          restaurant={restaurant}
                          onDelete={() => handleDelete(restaurant.id)}
                        />
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </section>

        {/* Discover Section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="h-6 w-6 text-primary" />
              Top Rated Nearby
            </h2>
            <div className="flex items-center gap-2">
              <Button
                variant={view === 'list' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setView('list')}
              >
                <List className="h-4 w-4 mr-1" />
                List
              </Button>
              <Button
                variant={view === 'map' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setView('map')}
              >
                <Map className="h-4 w-4 mr-1" />
                Map
              </Button>
            </div>
          </div>

          {/* Search and Filters */}
          <Card className="mb-6">
            <CardContent className="p-4 space-y-4">
              <div className="flex gap-4 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search restaurants, addresses, notes..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={minRating} onValueChange={setMinRating}>
                  <SelectTrigger className="w-[180px]">
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Filter by rating" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Ratings</SelectItem>
                    <SelectItem value="3">3+ Stars</SelectItem>
                    <SelectItem value="4">4+ Stars</SelectItem>
                    <SelectItem value="5">5 Stars Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap gap-2">
                {KEYWORD_TAGS.map((keyword) => (
                  <Badge
                    key={keyword}
                    variant={selectedKeywords.includes(keyword) ? 'default' : 'outline'}
                    className="cursor-pointer transition-colors"
                    onClick={() => toggleKeyword(keyword)}
                  >
                    {keyword}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {view === 'map' && !mapboxToken ? (
            <Card className="mb-6">
              <CardContent className="p-6">
                <h3 className="font-medium mb-2">Enter your Mapbox Token</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  To view the interactive map, you need a Mapbox public token. Get one free at{' '}
                  <a
                    href="https://mapbox.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    mapbox.com
                  </a>
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="pk.eyJ1..."
                    value={mapboxToken}
                    onChange={(e) => setMapboxToken(e.target.value)}
                  />
                  <Button disabled={!mapboxToken}>
                    Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : view === 'map' && mapboxToken ? (
            <div className="relative w-full h-[600px] rounded-xl overflow-hidden bg-card">
              <MapComponent token={mapboxToken} restaurants={filteredNearbyRestaurants} />
            </div>
          ) : (
            <div className="space-y-4">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredNearbyRestaurants.length === 0 ? (
                <div className="text-center py-12 bg-card rounded-xl">
                  <MapPin className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <h3 className="text-lg font-medium mb-2">No restaurants found</h3>
                  <p className="text-muted-foreground">
                    {searchQuery || selectedKeywords.length > 0 
                      ? 'Try adjusting your search or filters' 
                      : 'Follow more people to discover their favorite spots'}
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {filteredNearbyRestaurants.map((restaurant) => (
                    <Card key={restaurant.id} className="overflow-hidden">
                      <div className="relative aspect-video bg-muted overflow-hidden">
                        {restaurant.images?.[0]?.image_url ? (
                          <img
                            src={restaurant.images[0].image_url}
                            alt={restaurant.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-accent/20">
                            <MapPin className="h-12 w-12 text-muted-foreground/50" />
                          </div>
                        )}
                        {restaurant.folder && (
                          <Badge
                            className="absolute top-3 left-3"
                            style={{ backgroundColor: restaurant.folder.color }}
                          >
                            {restaurant.folder.name}
                          </Badge>
                        )}
                      </div>
                      <CardContent className="p-4">
                        <h3 className="font-semibold text-lg truncate">{restaurant.name}</h3>
                        {restaurant.address && (
                          <p className="text-sm text-muted-foreground truncate flex items-center gap-1 mt-1">
                            <MapPin className="h-3 w-3 flex-shrink-0" />
                            {restaurant.address}
                          </p>
                        )}
                        <div className="flex items-center gap-4 mt-2">
                          {restaurant.rating && (
                            <div className="flex items-center gap-1">
                              {Array.from({ length: 5 }).map((_, i) => (
                                <Star
                                  key={i}
                                  className={`h-4 w-4 ${
                                    i < restaurant.rating! ? 'text-yellow-500 fill-yellow-500' : 'text-muted'
                                  }`}
                                />
                              ))}
                            </div>
                          )}
                          {restaurant.price_level && (
                            <span className="text-sm text-muted-foreground">
                              {'$'.repeat(restaurant.price_level)}
                            </span>
                          )}
                        </div>
                        {restaurant.notes && (
                          <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                            {restaurant.notes}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      <AddRestaurantDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        folders={folders}
        onSuccess={fetchData}
      />
    </div>
  );
}

function MapComponent({ token, restaurants }: { token: string; restaurants: Restaurant[] }) {
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    if (!token) return;

    const script = document.createElement('script');
    script.src = 'https://api.mapbox.com/mapbox-gl-js/v3.0.1/mapbox-gl.js';
    script.onload = () => {
      const link = document.createElement('link');
      link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.0.1/mapbox-gl.css';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
      setMapLoaded(true);
    };
    document.head.appendChild(script);

    return () => {
      document.head.removeChild(script);
    };
  }, [token]);

  useEffect(() => {
    if (!mapLoaded || !(window as any).mapboxgl) return;

    const mapboxgl = (window as any).mapboxgl;
    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: 'map-container',
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-74.006, 40.7128],
      zoom: 10,
    });

    map.addControl(new mapboxgl.NavigationControl());

    restaurants.forEach((restaurant) => {
      if (restaurant.latitude && restaurant.longitude) {
        const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
          <div class="p-2">
            <h3 class="font-semibold">${restaurant.name}</h3>
            ${restaurant.address ? `<p class="text-sm text-gray-500">${restaurant.address}</p>` : ''}
            ${restaurant.rating ? `<p class="text-sm">⭐ ${restaurant.rating}/5</p>` : ''}
          </div>
        `);

        new mapboxgl.Marker({ color: '#E91E63' })
          .setLngLat([restaurant.longitude, restaurant.latitude])
          .setPopup(popup)
          .addTo(map);
      }
    });

    if (restaurants.length > 0) {
      const validRestaurants = restaurants.filter((r) => r.latitude && r.longitude);
      if (validRestaurants.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        validRestaurants.forEach((r) => {
          bounds.extend([r.longitude!, r.latitude!]);
        });
        map.fitBounds(bounds, { padding: 50 });
      }
    }

    return () => map.remove();
  }, [mapLoaded, restaurants, token]);

  return <div id="map-container" className="w-full h-full" />;
}
