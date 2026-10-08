import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMapCenter } from '@/hooks/useMapCenter';
import { PlaceMap, type MapPoint } from '@/components/maps/PlaceMap';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { withApplePlaceDetails } from '@/lib/appleMaps';
import { Loader2, Map, Plus, Check, Clock, Search, FileDown, Pencil } from 'lucide-react';
import { exportListAsPdf } from '@/lib/exportPdf';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { RestaurantCard } from '@/components/restaurants/RestaurantCard';
import { CardGridSkeleton } from '@/components/shared/CardGridSkeleton';
import { hapticSuccess, hapticWarning } from '@/lib/haptics';
import { RestaurantListRow } from '@/components/restaurants/RestaurantListRow';
import { RestaurantDetailDialog, type DetailRestaurant } from '@/components/restaurants/RestaurantDetailDialog';
import { RestaurantListToolbar } from '@/components/restaurants/RestaurantListToolbar';
import { AddRestaurantDialog } from '@/components/restaurants/AddRestaurantDialog';
import { EditRestaurantDialog } from '@/components/restaurants/EditRestaurantDialog';
import { FolderList } from '@/components/folders/FolderList';
import { ManageTypesSheet } from '@/components/folders/ManageTypesSheet';
import { useViewMode } from '@/hooks/useViewMode';
import type { RestaurantSortBy } from '@/hooks/useRestaurantListControls';
import { toast } from 'sonner';
import { useLocationPermission } from '@/hooks/useLocationPermission';
import { LocationDeniedDialog } from '@/components/shared/LocationDeniedDialog';
import { NearMeButton } from '@/components/shared/NearMeButton';

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
  folder_ids: string[];
  folders?: { id: string; name: string; color: string; icon?: string | null }[];
  images?: { image_url: string; id: string }[];
}

interface Folder {
  id: string;
  name: string;
  color: string;
  icon: string;
  sort_order: number | null;
}

async function fetchMyRestaurants(userId: string): Promise<Restaurant[]> {
  const { data, error } = await supabase
    .from('restaurants')
    .select(`
      *,
      images:restaurant_images(image_url, id)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  // Apple-saved places store only their Apple ID; fill in address and pin.
  return withApplePlaceDetails(data || []);
}

async function fetchMyFolders(userId: string): Promise<Folder[]> {
  const { data, error } = await supabase
    .from('folders')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}


export default function MyList() {
  const { user, session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [activeTab, setActiveTab] = useState<'to_go' | 'went_to'>('to_go');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedPriceLevel, setSelectedPriceLevel] = useState<number[]>([0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<RestaurantSortBy>('name');
  const [viewMode, setViewMode] = useViewMode('mylist');
  const [detailRestaurant, setDetailRestaurant] = useState<Restaurant | null>(null);
  const [focusedRestaurantId, setFocusedRestaurantId] = useState<string | null>(null);
  const [modifyMode, setModifyMode] = useState(false);
  const [manageTypesOpen, setManageTypesOpen] = useState(false);
  const mapFlyToRef = useRef<((lat: number, lng: number, restaurantId: string) => void) | null>(null);
  const mapFlyToMeRef = useRef<(() => void) | null>(null);
  const [locationDeniedOpen, setLocationDeniedOpen] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  const { data: restaurants = [], isLoading: loading } = useQuery({
    queryKey: ['restaurants', user?.id],
    queryFn: () => fetchMyRestaurants(user!.id),
    enabled: !!user,
  });

  const { data: folders = [] } = useQuery({
    queryKey: ['folders', user?.id],
    queryFn: () => fetchMyFolders(user!.id),
    enabled: !!user,
  });


  const invalidateRestaurants = () =>
    queryClient.invalidateQueries({ queryKey: ['restaurants', user?.id] });
  // Restaurants embed their folder's name/color/icon via a join at fetch
  // time, so editing a folder (e.g. its emoji) needs to invalidate the
  // restaurants cache too - otherwise the sidebar picks up the change
  // (it re-fetches folders directly) but the map pins stay stale, since
  // they're built from the already-cached restaurants array.
  const invalidateFolders = () => {
    queryClient.invalidateQueries({ queryKey: ['folders', user?.id] });
    invalidateRestaurants();
  };

  const priceFilter = selectedPriceLevel[0];

  // Resolve each restaurant's folder_ids into full folder objects (name,
  // color, icon) by looking them up in the already-fetched folders list -
  // there's no DB join for an array column, so this is done client-side
  // once here rather than duplicated at every render call site.
  const restaurantsWithFolders = useMemo(
    () =>
      restaurants.map((r) => ({
        ...r,
        folders: folders.filter((f) => (r.folder_ids || []).includes(f.id)),
      })),
    [restaurants, folders],
  );

  // Memoized so the map below (which keys its GPS/marker effects off this
  // array's reference) doesn't rebuild on every unrelated re-render.
  const filteredRestaurants = useMemo(
    () =>
      restaurantsWithFolders
        .filter((r) => !selectedFolder || (r.folder_ids || []).includes(selectedFolder))
        .filter((r) => priceFilter === 0 || r.price_level === priceFilter)
        .filter((r) => {
          if (!searchQuery.trim()) return true;
          const q = searchQuery.toLowerCase();
          return r.name.toLowerCase().includes(q) || r.address?.toLowerCase().includes(q);
        })
        .sort((a, b) => {
          switch (sortBy) {
            case 'price_asc':
              return (a.price_level ?? 99) - (b.price_level ?? 99);
            case 'price_desc':
              return (b.price_level ?? -1) - (a.price_level ?? -1);
            case 'rating_desc':
              return (b.rating ?? -1) - (a.rating ?? -1);
            default:
              return a.name.localeCompare(b.name);
          }
        }),
    [restaurantsWithFolders, selectedFolder, priceFilter, searchQuery, sortBy],
  );
  const toGoList = useMemo(
    () => filteredRestaurants.filter((r) => r.status === 'to_go'),
    [filteredRestaurants],
  );
  const wentToList = useMemo(
    () => filteredRestaurants.filter((r) => r.status === 'went_to'),
    [filteredRestaurants],
  );
  const currentList = activeTab === 'to_go' ? toGoList : wentToList;

  const handleMarkVisited = async (restaurantId: string) => {
    const { data, error } = await supabase
      .from('restaurants')
      .update({ status: 'went_to', visited_at: new Date().toISOString() })
      .eq('id', restaurantId)
      .select(`
        *,
        images:restaurant_images(image_url, id)
      `)
      .single();

    if (error) {
      toast.error('Failed to update restaurant');
    } else {
      void hapticSuccess();
      toast.success('Marked as been there! Add rating, comments & photos.');
      invalidateRestaurants();
      const [located] = await withApplePlaceDetails([data as Restaurant]);
      setSelectedRestaurant(located);
      setEditDialogOpen(true);
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
      void hapticWarning();
      toast.success('Restaurant deleted');
      invalidateRestaurants();
    }
  };

  const handleEdit = (restaurant: Restaurant) => {
    setSelectedRestaurant(restaurant);
    setEditDialogOpen(true);
  };

  const handleRestaurantClick = (restaurant: Restaurant | { id: string; name: string; latitude: number | null; longitude: number | null; folder_ids: string[] }) => {
    if (restaurant.latitude != null && restaurant.longitude != null) {
      setFocusedRestaurantId(restaurant.id);
      // Scroll to map
      mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Small delay to ensure map is rendered before flying
      setTimeout(() => {
        mapFlyToRef.current?.(restaurant.latitude!, restaurant.longitude!, restaurant.id);
      }, 300);
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

      <main className="container py-4 sm:py-8 px-4 sm:px-6 lg:px-8 space-y-4 sm:space-y-6">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl sm:text-3xl font-bold">My Restaurants</h1>
          <div className="flex items-center gap-2">
            <Button
              variant={modifyMode ? 'default' : 'outline'}
              size="sm"
              onClick={() => setModifyMode((m) => !m)}
            >
              <Pencil className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">{modifyMode ? 'Done' : 'Modify'}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void exportListAsPdf(restaurants, folders)}
            >
              <FileDown className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Export PDF</span>
            </Button>
            <Button onClick={() => setAddDialogOpen(true)} size="sm" className="sm:size-default">
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Add Place</span>
            </Button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar with folders - hidden on mobile, sticky */}
          <aside className="hidden lg:block w-64 shrink-0">
            <div className="sticky top-8">
              <Card>
                <CardContent className="p-4">
                  <FolderList
                    folders={folders}
                    selectedFolder={selectedFolder}
                    onSelectFolder={setSelectedFolder}
                    onFoldersChange={invalidateFolders}
                    restaurants={restaurants}
                    onRestaurantClick={handleRestaurantClick}
                  />
                </CardContent>
              </Card>
            </div>
          </aside>

          {/* Main content.
              min-w-0 is load-bearing, not tidying: a flex item defaults to
              min-width:auto, meaning it refuses to shrink below the
              intrinsic minimum width of its contents. This column holds the
              search field, the tab bar, the map canvas and the restaurant
              grid, so any one of them with a wide intrinsic minimum (a long
              unbroken address, the Mapbox canvas) would stretch this column
              past the viewport. html/body/#root set overflow-x:hidden,
              which hides the scrollbar but doesn't stop the layout from
              being too wide - so on a phone the content simply sat wider
              than the screen and could be dragged sideways. */}
          <div className="flex-1 min-w-0 flex flex-col gap-6">
            {/* Restaurant list */}
            <Card>
              <CardContent className="p-4">
                {/* Search */}
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Search your restaurants..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>

                {/* Price slider */}
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-sm text-muted-foreground whitespace-nowrap">Price:</span>
                  <Slider
                    value={selectedPriceLevel}
                    onValueChange={setSelectedPriceLevel}
                    min={0}
                    max={4}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-sm font-medium w-12 text-right">
                    {priceFilter === 0 ? 'All' : '$'.repeat(priceFilter)}
                  </span>
                </div>

                {/* Type/sort/view controls */}
                <div className="mb-4">
                  <RestaurantListToolbar
                    availableTypes={folders.map((f) => f.name)}
                    typeFilter={folders.find((f) => f.id === selectedFolder)?.name ?? null}
                    onTypeFilterChange={(name) =>
                      setSelectedFolder(name ? folders.find((f) => f.name === name)?.id ?? null : null)
                    }
                    sortBy={sortBy}
                    onSortByChange={setSortBy}
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    manageMode={modifyMode}
                    onOpenManageTypes={() => setManageTypesOpen(true)}
                  />
                </div>

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
                      <CardGridSkeleton count={3} />
                    ) :toGoList.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No restaurants on your to-go list yet</p>
                      </div>
                    ) : viewMode === 'list' ? (
                      <div className="space-y-2">
                        {toGoList.map((restaurant) => (
                          <RestaurantListRow
                            key={restaurant.id}
                            restaurant={restaurant}
                            onOpenDetail={() => setDetailRestaurant(restaurant)}
                            onFlyTo={() => handleRestaurantClick(restaurant)}
                            onMarkVisited={() => handleMarkVisited(restaurant.id)}
                            onEdit={() => handleEdit(restaurant)}
                            onDelete={() => handleDelete(restaurant.id)}
                            quickDelete={modifyMode}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="grid gap-3 sm:gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
                        {toGoList.map((restaurant) => (
                          <div
                            key={restaurant.id}
                            onClick={modifyMode ? undefined : () => handleRestaurantClick(restaurant)}
                            // min-w-0 for the same reason as the column
                            // above: grid items also default to
                            // min-width:auto and will otherwise widen their
                            // track to fit a long unbroken name or address.
                            className={modifyMode ? 'min-w-0' : 'min-w-0 cursor-pointer'}
                          >
                            <RestaurantCard
                              restaurant={restaurant}
                              onMarkVisited={() => handleMarkVisited(restaurant.id)}
                              onEdit={() => handleEdit(restaurant)}
                              onDelete={() => handleDelete(restaurant.id)}
                              quickDelete={modifyMode}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="went_to">
                    {loading ? (
                      <CardGridSkeleton count={3} />
                    ) :wentToList.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Check className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>You haven't been to any restaurants yet</p>
                      </div>
                    ) : viewMode === 'list' ? (
                      <div className="space-y-2">
                        {wentToList.map((restaurant) => (
                          <RestaurantListRow
                            key={restaurant.id}
                            restaurant={restaurant}
                            onOpenDetail={() => setDetailRestaurant(restaurant)}
                            onFlyTo={() => handleRestaurantClick(restaurant)}
                            onEdit={() => handleEdit(restaurant)}
                            onDelete={() => handleDelete(restaurant.id)}
                            quickDelete={modifyMode}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="grid gap-3 sm:gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
                        {wentToList.map((restaurant) => (
                          <div
                            key={restaurant.id}
                            onClick={modifyMode ? undefined : () => handleRestaurantClick(restaurant)}
                            className={modifyMode ? 'min-w-0' : 'min-w-0 cursor-pointer'}
                          >
                            <RestaurantCard
                              restaurant={restaurant}
                              onEdit={() => handleEdit(restaurant)}
                              onDelete={() => handleDelete(restaurant.id)}
                              quickDelete={modifyMode}
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
            <Card className="overflow-hidden" ref={mapRef}>
              <CardContent className="p-0">
                <div className="h-[250px] sm:h-[400px] lg:h-[500px] relative">
                  <>
                      <MapComponent
                        restaurants={currentList}
                        focusedRestaurantId={focusedRestaurantId}
                        onFocusRestaurant={setFocusedRestaurantId}
                        flyToRef={mapFlyToRef}
                        flyToMeRef={mapFlyToMeRef}
                        onLocationDenied={() => setLocationDeniedOpen(true)}
                      />
                      <NearMeButton onClick={() => mapFlyToMeRef.current?.()} />
                    </>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <ManageTypesSheet
        open={manageTypesOpen}
        onOpenChange={setManageTypesOpen}
        folders={folders}
        onFoldersChange={invalidateFolders}
      />

      <AddRestaurantDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        folders={folders}
        onSuccess={invalidateRestaurants}
      />

      <EditRestaurantDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        restaurant={selectedRestaurant}
        folders={folders}
        onSuccess={invalidateRestaurants}
      />

      <RestaurantDetailDialog
        restaurant={detailRestaurant as DetailRestaurant | null}
        onOpenChange={(open) => !open && setDetailRestaurant(null)}
        onEdit={() => {
          if (detailRestaurant) handleEdit(detailRestaurant);
          setDetailRestaurant(null);
        }}
        onDelete={() => {
          if (detailRestaurant) handleDelete(detailRestaurant.id);
          setDetailRestaurant(null);
        }}
        onMarkVisited={
          detailRestaurant?.status === 'to_go'
            ? () => {
                handleMarkVisited(detailRestaurant.id);
                setDetailRestaurant(null);
              }
            : undefined
        }
      />

      <LocationDeniedDialog open={locationDeniedOpen} onOpenChange={setLocationDeniedOpen} />
    </div>
  );
}

interface MapComponentProps {
  restaurants: Restaurant[];
  focusedRestaurantId: string | null;
  onFocusRestaurant: (id: string | null) => void;
  flyToRef: React.MutableRefObject<((lat: number, lng: number, restaurantId: string) => void) | null>;
  flyToMeRef: React.MutableRefObject<(() => void) | null>;
  onLocationDenied: () => void;
}

// Pins take the colour and emoji of the place's first type (folder).
function MapComponent({ restaurants, focusedRestaurantId, onFocusRestaurant, flyToRef, flyToMeRef, onLocationDenied }: MapComponentProps) {
  const { center } = useMapCenter(restaurants);
  const points = useMemo<MapPoint[]>(
    () =>
      restaurants.map((r) => ({
        id: r.id,
        name: r.name,
        address: r.address,
        latitude: r.latitude,
        longitude: r.longitude,
        color: r.folders?.[0]?.color,
        icon: r.folders?.[0]?.icon,
      })),
    [restaurants],
  );
  return (
    <PlaceMap
      points={points}
      center={center}
      focusedId={focusedRestaurantId}
      onSelect={onFocusRestaurant}
      flyToRef={flyToRef}
      flyToMeRef={flyToMeRef}
      onLocationDenied={onLocationDenied}
    />
  );
}
