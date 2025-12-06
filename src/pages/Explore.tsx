import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { MapPin, Star, DollarSign, Loader2, Map, List } from 'lucide-react';

interface Restaurant {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  price_level: number | null;
  status: string;
  folder?: { name: string; color: string } | null;
  images?: { image_url: string }[];
}

export default function Explore() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'map' | 'list'>('list');
  const [mapboxToken, setMapboxToken] = useState('');
  const [showTokenInput, setShowTokenInput] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  const fetchRestaurants = async () => {
    if (!user) return;

    setLoading(true);
    const { data, error } = await supabase
      .from('restaurants')
      .select(`
        *,
        folder:folders(name, color),
        images:restaurant_images(image_url)
      `)
      .eq('user_id', user.id)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null);

    if (error) {
      console.error('Error fetching restaurants:', error);
    } else {
      setRestaurants(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (user) {
      fetchRestaurants();
    }
  }, [user]);

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
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">Explore</h1>
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
              onClick={() => {
                if (!mapboxToken) {
                  setShowTokenInput(true);
                }
                setView('map');
              }}
            >
              <Map className="h-4 w-4 mr-1" />
              Map
            </Button>
          </div>
        </div>

        {view === 'map' && !mapboxToken && (
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
                <Button onClick={() => setShowTokenInput(false)} disabled={!mapboxToken}>
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {view === 'map' && mapboxToken ? (
          <div className="relative w-full h-[600px] rounded-xl overflow-hidden bg-card">
            <MapComponent token={mapboxToken} restaurants={restaurants} />
          </div>
        ) : (
          <div className="space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : restaurants.length === 0 ? (
              <div className="text-center py-12 bg-card rounded-xl">
                <MapPin className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium mb-2">No locations yet</h3>
                <p className="text-muted-foreground">
                  Add addresses with coordinates to see them on the map
                </p>
              </div>
            ) : (
              restaurants.map((restaurant) => (
                <Card key={restaurant.id}>
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="h-16 w-16 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                      {restaurant.images?.[0]?.image_url ? (
                        <img
                          src={restaurant.images[0].image_url}
                          alt={restaurant.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <MapPin className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{restaurant.name}</h3>
                        {restaurant.folder && (
                          <Badge
                            variant="secondary"
                            style={{ backgroundColor: restaurant.folder.color, color: 'white' }}
                          >
                            {restaurant.folder.name}
                          </Badge>
                        )}
                      </div>
                      {restaurant.address && (
                        <p className="text-sm text-muted-foreground flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {restaurant.address}
                        </p>
                      )}
                      <div className="flex items-center gap-4 mt-1">
                        {restaurant.rating && (
                          <div className="flex items-center gap-1">
                            <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                            <span className="text-sm">{restaurant.rating}</span>
                          </div>
                        )}
                        {restaurant.price_level && (
                          <span className="text-sm text-muted-foreground">
                            {'$'.repeat(restaurant.price_level)}
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}
      </main>
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
