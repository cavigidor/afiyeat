import { useState, useEffect, useRef } from 'react';
import { useMapCenter } from '@/hooks/useMapCenter';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { MapPin, Loader2, Map, Plus, Check, Clock } from 'lucide-react';
import { RestaurantCard } from '@/components/restaurants/RestaurantCard';
import { AddRestaurantDialog } from '@/components/restaurants/AddRestaurantDialog';
import { EditRestaurantDialog } from '@/components/restaurants/EditRestaurantDialog';
import { FolderList } from '@/components/folders/FolderList';
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
  folder_id: string | null;
  folder?: { name: string; color: string } | null;
  images?: { image_url: string; id: string }[];
}

interface Folder {
  id: string;
  name: string;
  color: string;
  icon: string;
}

export default function MyList() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapboxToken, setMapboxToken] = useState<string | null>(null);
  const [mapboxLoading, setMapboxLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [activeTab, setActiveTab] = useState<'to_go' | 'went_to'>('to_go');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [focusedRestaurantId, setFocusedRestaurantId] = useState<string | null>(null);
  const mapFlyToRef = useRef<((lat: number, lng: number, restaurantId: string) => void) | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    
    const { data: restaurantData, error } = await supabase
      .from('restaurants')
      .select(`
        *,
        folder:folders(name, color),
        images:restaurant_images(image_url, id)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching restaurants:', error);
    } else {
      setRestaurants(restaurantData || []);
    }

    const { data: folderData } = await supabase
      .from('folders')
      .select('*')
      .eq('user_id', user.id);
    
    setFolders(folderData || []);
    setLoading(false);
  };

  useEffect(() => {
    if (user) {
      fetchData();
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

  const filteredRestaurants = selectedFolder 
    ? restaurants.filter(r => r.folder_id === selectedFolder)
    : restaurants;
  const toGoList = filteredRestaurants.filter(r => r.status === 'to_go');
  const wentToList = filteredRestaurants.filter(r => r.status === 'went_to');
  const currentList = activeTab === 'to_go' ? toGoList : wentToList;

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

  const handleEdit = (restaurant: Restaurant) => {
    setSelectedRestaurant(restaurant);
    setEditDialogOpen(true);
  };

  const handleRestaurantClick = (restaurant: Restaurant) => {
    if (restaurant.latitude && restaurant.longitude) {
      setFocusedRestaurantId(restaurant.id);
      // Small delay to ensure map is rendered before flying
      setTimeout(() => {
        mapFlyToRef.current?.(restaurant.latitude!, restaurant.longitude!, restaurant.id);
      }, 100);
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

      <main className="container py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">My List</h1>
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Restaurant
          </Button>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar with folders - hidden on mobile */}
          <aside className="hidden lg:block w-64 shrink-0">
            <Card>
              <CardContent className="p-4">
                <FolderList
                  folders={folders}
                  selectedFolder={selectedFolder}
                  onSelectFolder={setSelectedFolder}
                  onFoldersChange={fetchData}
                />
              </CardContent>
            </Card>
          </aside>

          {/* Main content */}
          <div className="flex-1 flex flex-col gap-6">
            {/* Restaurant list */}
            <Card>
              <CardContent className="p-4">
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'to_go' | 'went_to')}>
                  <TabsList className="mb-4">
                    <TabsTrigger value="to_go" className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      To Go ({toGoList.length})
                    </TabsTrigger>
                    <TabsTrigger value="went_to" className="flex items-center gap-2">
                      <Check className="h-4 w-4" />
                      Been There ({wentToList.length})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="to_go">
                    {loading ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                    ) : toGoList.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No restaurants on your to-go list yet</p>
                      </div>
                    ) : (
                      <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
                        {toGoList.map((restaurant) => (
                          <div 
                            key={restaurant.id} 
                            onClick={() => handleRestaurantClick(restaurant)}
                            className="cursor-pointer"
                          >
                            <RestaurantCard
                              restaurant={restaurant}
                              onMarkVisited={() => handleMarkVisited(restaurant.id)}
                              onEdit={() => handleEdit(restaurant)}
                              onDelete={() => handleDelete(restaurant.id)}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="went_to">
                    {loading ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                    ) : wentToList.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Check className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>You haven't visited any restaurants yet</p>
                      </div>
                    ) : (
                      <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
                        {wentToList.map((restaurant) => (
                          <div 
                            key={restaurant.id} 
                            onClick={() => handleRestaurantClick(restaurant)}
                            className="cursor-pointer"
                          >
                            <RestaurantCard
                              restaurant={restaurant}
                              onEdit={() => handleEdit(restaurant)}
                              onDelete={() => handleDelete(restaurant.id)}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
            
            {/* Map - always visible */}
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="h-[400px] lg:h-[500px] relative">
                  {mapboxLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  ) : mapboxToken ? (
                    <MapComponent 
                      token={mapboxToken} 
                      restaurants={currentList} 
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
          </div>
        </div>
      </main>

      <AddRestaurantDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        folders={folders}
        onSuccess={fetchData}
      />

      <EditRestaurantDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        restaurant={selectedRestaurant}
        folders={folders}
        onSuccess={fetchData}
      />
    </div>
  );
}

interface MapComponentProps {
  token: string;
  restaurants: Restaurant[];
  focusedRestaurantId: string | null;
  onFocusRestaurant: (id: string | null) => void;
  flyToRef: React.MutableRefObject<((lat: number, lng: number, restaurantId: string) => void) | null>;
}

function MapComponent({ token, restaurants, focusedRestaurantId, onFocusRestaurant, flyToRef }: MapComponentProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<globalThis.Map<string, any>>(new globalThis.Map());
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

      // Expose flyTo function
      flyToRef.current = (lat: number, lng: number, restaurantId: string) => {
        if (mapRef.current) {
          mapRef.current.flyTo({
            center: [lng, lat],
            zoom: 16,
            duration: 1500,
            essential: true
          });
          // Open the marker popup
          const marker = markersRef.current.get(restaurantId);
          if (marker) {
            marker.togglePopup();
          }
        }
      };
    };

    loadMapbox();

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      flyToRef.current = null;
    };
  }, [token, flyToRef]);

  useEffect(() => {
    if (!mapRef.current) return;

    // Clear existing markers
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

        // Sanitize for XSS prevention
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
          .addTo(mapRef.current);

        // Click handler for marker
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
