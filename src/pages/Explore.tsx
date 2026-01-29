import { useState, useEffect, useMemo, useRef } from 'react';
import { useMapCenter } from '@/hooks/useMapCenter';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { MapPin, Star, DollarSign, Loader2, Map, List, Search, Filter, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { useSignedImageUrl } from '@/hooks/useSignedImageUrl';

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

const KEYWORD_TAGS = [
  'coffee', 'lunch', 'dinner', 'brunch', 'cheap', 'high-end', 
  'cafe', 'bar', 'pizza', 'sushi', 'italian', 'mexican', 'asian'
];

export default function Explore() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [nearbyRestaurants, setNearbyRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'map' | 'list'>('list');
  const [mapboxToken, setMapboxToken] = useState<string | null>(null);
  const [mapboxLoading, setMapboxLoading] = useState(false);
  const [mapboxError, setMapboxError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [minRating, setMinRating] = useState<string>('all');

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  const fetchData = async () => {
    if (!user) return;

    setLoading(true);

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

  // Fetch Mapbox token when switching to map view
  useEffect(() => {
    const fetchMapboxToken = async () => {
      if (view !== 'map' || mapboxToken) return;
      
      setMapboxLoading(true);
      setMapboxError(null);
      
      try {
        const { data, error } = await supabase.functions.invoke('get-mapbox-token');
        
        if (error) {
          console.error('Error fetching Mapbox token:', error);
          setMapboxError('Failed to load map configuration');
          return;
        }
        
        if (data?.token) {
          setMapboxToken(data.token);
        } else {
          setMapboxError('Map token not configured');
        }
      } catch (err) {
        console.error('Error fetching Mapbox token:', err);
        setMapboxError('Failed to load map');
      } finally {
        setMapboxLoading(false);
      }
    };

    fetchMapboxToken();
  }, [view, mapboxToken]);

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

      <main className="container py-8 space-y-6">
        {/* Discover Section */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <TrendingUp className="h-8 w-8 text-primary" />
            Discover
          </h1>
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

        <p className="text-muted-foreground">
          Explore restaurants from people you follow
        </p>

        {/* Search and Filters */}
        <Card>
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

        {view === 'map' ? (
          mapboxLoading ? (
            <div className="flex items-center justify-center py-12 bg-card rounded-xl h-[600px]">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : mapboxError ? (
            <div className="text-center py-12 bg-card rounded-xl h-[600px] flex flex-col items-center justify-center">
              <Map className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">Map Unavailable</h3>
              <p className="text-muted-foreground">{mapboxError}</p>
            </div>
          ) : mapboxToken ? (
            <div className="relative w-full h-[600px] rounded-xl overflow-hidden bg-card">
              <MapComponent token={mapboxToken} restaurants={filteredNearbyRestaurants} />
            </div>
          ) : null
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
                  <ExploreRestaurantCard key={restaurant.id} restaurant={restaurant} />
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// Restaurant card component with signed URL support
function ExploreRestaurantCard({ restaurant }: { restaurant: Restaurant }) {
  const imageUrl = restaurant.images?.[0]?.image_url;
  const { signedUrl, loading: imageLoading } = useSignedImageUrl(imageUrl);

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-video bg-muted overflow-hidden">
        {imageLoading ? (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-accent/20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/50" />
          </div>
        ) : signedUrl ? (
          <img
            src={signedUrl}
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
                    i < Math.round(restaurant.rating! / 2) ? 'text-yellow-500 fill-yellow-500' : 'text-muted'
                  }`}
                />
              ))}
            </div>
          )}
          {restaurant.price_level && (
            <div className="flex items-center">
              {Array.from({ length: 4 }).map((_, i) => (
                <DollarSign
                  key={i}
                  className={`h-4 w-4 -ml-1 first:ml-0 ${
                    i < restaurant.price_level! ? 'text-primary' : 'text-muted'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
        {restaurant.notes && (
          <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{restaurant.notes}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MapComponent({ token, restaurants }: { token: string; restaurants: Restaurant[] }) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const { center } = useMapCenter(restaurants);

  useEffect(() => {
    if (!mapContainer.current || !token) return;

    const loadMapbox = async () => {
      const mapboxgl = (await import('mapbox-gl')).default;
      await import('mapbox-gl/dist/mapbox-gl.css');

      mapboxgl.accessToken = token;

      if (mapRef.current) return;

      mapRef.current = new mapboxgl.Map({
        container: mapContainer.current!,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [center.lng, center.lat],
        zoom: 11,
      });

      mapRef.current.addControl(new mapboxgl.NavigationControl(), 'top-right');
    };

    loadMapbox();

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [token]);

  useEffect(() => {
    if (!mapRef.current) return;

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    const restaurantsWithLocation = restaurants.filter(r => r.latitude && r.longitude);

    if (restaurantsWithLocation.length === 0) return;

    const loadMarkers = async () => {
      const mapboxgl = (await import('mapbox-gl')).default;

      restaurantsWithLocation.forEach(restaurant => {
        const el = document.createElement('div');
        el.className = 'w-8 h-8 bg-primary rounded-full flex items-center justify-center text-primary-foreground shadow-lg cursor-pointer';
        el.innerHTML = '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>';

        // Sanitize HTML to prevent XSS
        const safeName = restaurant.name.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeAddress = restaurant.address?.replace(/</g, '&lt;').replace(/>/g, '&gt;') || '';

        const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
          <div class="p-2">
            <h3 class="font-semibold">${safeName}</h3>
            ${safeAddress ? `<p class="text-sm text-gray-600">${safeAddress}</p>` : ''}
          </div>
        `);

        const marker = new mapboxgl.Marker(el)
          .setLngLat([restaurant.longitude!, restaurant.latitude!])
          .setPopup(popup)
          .addTo(mapRef.current!);

        markersRef.current.push(marker);
      });

      // Fit bounds to show all markers
      if (restaurantsWithLocation.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        restaurantsWithLocation.forEach(r => {
          bounds.extend([r.longitude!, r.latitude!]);
        });
        mapRef.current!.fitBounds(bounds, { padding: 50, maxZoom: 14 });
      }
    };

    // Wait for map to load before adding markers
    const checkMap = setInterval(() => {
      if (mapRef.current?.loaded()) {
        clearInterval(checkMap);
        loadMarkers();
      }
    }, 100);

    return () => clearInterval(checkMap);
  }, [restaurants]);

  return <div ref={mapContainer} className="w-full h-full" />;
}
