import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Search, ArrowLeft, Circle, Check, Map, Lock } from 'lucide-react';
import { useViewMode } from '@/hooks/useViewMode';
import { useMapCenter } from '@/hooks/useMapCenter';
import { ListViewToggle } from '@/components/shared/ListViewToggle';
import type { CustomList } from '@/components/lists/CreateListDialog';
import type { CustomListItem } from '@/components/lists/AddCustomListItemDialog';
import { CustomListItemRow } from '@/components/lists/CustomListItemRow';
import { CustomListItemCard } from '@/components/lists/CustomListItemCard';
import { ListTypesManager } from '@/components/lists/ListTypesManager';
import type { ManagedListType } from '@/hooks/useListTypeManagement';
import { getPriceSortValue, getRatingSortValue } from '@/lib/customListValues';
import { getDirectionsPopupHtml } from '@/lib/directions';
import { createPinElement } from '@/lib/mapPin';

type SortBy = 'name' | 'price_asc' | 'price_desc' | 'rating_desc';

interface OwnerProfile {
  user_id: string;
  username: string | null;
  display_name: string | null;
  is_private: boolean;
}

async function fetchMapboxTokenValue(): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('get-mapbox-token');
  if (error) throw error;
  return data?.token ?? null;
}

async function fetchOwnerProfile(userId: string): Promise<OwnerProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, username, display_name, is_private')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchFollowStatus(viewerId: string, targetId: string): Promise<'accepted' | 'pending' | null> {
  const { data, error } = await supabase
    .from('follows')
    .select('status')
    .eq('follower_id', viewerId)
    .eq('following_id', targetId)
    .maybeSingle();
  if (error) throw error;
  return (data?.status as 'accepted' | 'pending') ?? null;
}

// Scoped to both listId and the owner's userId - RLS already restricts this
// to lists the viewer is actually allowed to see, but pinning it to the
// :userId route param too means a stale/guessed listId can never render
// under the wrong owner's name.
async function fetchList(listId: string, ownerUserId: string): Promise<CustomList | null> {
  const { data, error } = await supabase
    .from('custom_lists')
    .select('*')
    .eq('id', listId)
    .eq('user_id', ownerUserId)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as CustomList | null;
}

async function fetchItems(listId: string): Promise<CustomListItem[]> {
  const { data, error } = await supabase
    .from('custom_list_items')
    .select('*, images:custom_list_item_images(id, image_url), type:custom_list_types(name, color, icon)')
    .eq('list_id', listId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as CustomListItem[];
}

async function fetchTypes(listId: string): Promise<ManagedListType[]> {
  const { data, error } = await supabase
    .from('custom_list_types')
    .select('*')
    .eq('list_id', listId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Read-only mirror of CustomListDetail.tsx for viewing another account's
// list. No add/edit/delete/status-toggle/settings anywhere - the item row
// and card components already go menu-less when those handlers are
// omitted, and ListTypesManager already renders as plain filter chips
// (or nothing, if the list has no types) when modifyMode is false.
export default function PublicListDetail() {
  const { userId, listId } = useParams<{ userId: string; listId: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'todo' | 'done'>('todo');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useViewMode(`public-list-${listId}`);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const mapFlyToRef = useRef<((lat: number, lng: number, itemId: string) => void) | null>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [user, authLoading, navigate]);

  const isOwnList = user?.id === userId;

  const { data: ownerProfile, isLoading: loadingProfile } = useQuery({
    queryKey: ['public-list-owner', userId],
    queryFn: () => fetchOwnerProfile(userId!),
    enabled: !!userId,
  });

  const { data: followStatus } = useQuery({
    queryKey: ['follow-status', user?.id, userId],
    queryFn: () => fetchFollowStatus(user!.id, userId!),
    enabled: !!user && !!userId && !isOwnList,
  });

  const canView = isOwnList || !ownerProfile?.is_private || followStatus === 'accepted';

  const { data: list, isLoading: loadingList } = useQuery({
    queryKey: ['public-list', listId, userId],
    queryFn: () => fetchList(listId!, userId!),
    enabled: !!listId && !!userId && canView,
  });

  const { data: items = [], isLoading: loadingItems } = useQuery({
    queryKey: ['public-list-items', listId],
    queryFn: () => fetchItems(listId!),
    enabled: !!listId && !!list,
  });

  const { data: types = [] } = useQuery({
    queryKey: ['public-list-types', listId],
    queryFn: () => fetchTypes(listId!),
    enabled: !!listId && !!list,
  });

  const { data: mapboxToken, isLoading: mapboxLoading } = useQuery({
    queryKey: ['mapbox-token'],
    queryFn: fetchMapboxTokenValue,
    enabled: !!user && !!list?.show_location,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const filteredItems = useMemo(
    () =>
      items
        .filter((i) => !selectedTypeId || i.type_id === selectedTypeId)
        .filter((i) => {
          if (!searchQuery.trim()) return true;
          const q = searchQuery.toLowerCase();
          return i.name.toLowerCase().includes(q) || i.address?.toLowerCase().includes(q);
        })
        .sort((a, b) => {
          if (!list) return 0;
          switch (sortBy) {
            case 'price_asc':
              return (getPriceSortValue(a, list) ?? 99) - (getPriceSortValue(b, list) ?? 99);
            case 'price_desc':
              return (getPriceSortValue(b, list) ?? -1) - (getPriceSortValue(a, list) ?? -1);
            case 'rating_desc':
              return (getRatingSortValue(b, list) ?? -1) - (getRatingSortValue(a, list) ?? -1);
            default:
              return a.name.localeCompare(b.name);
          }
        }),
    [items, searchQuery, sortBy, selectedTypeId, list],
  );
  const todoItems = useMemo(() => filteredItems.filter((i) => i.status === 'todo'), [filteredItems]);
  const doneItems = useMemo(() => filteredItems.filter((i) => i.status === 'done'), [filteredItems]);
  const currentItems = activeTab === 'todo' ? todoItems : doneItems;

  if (authLoading || loadingProfile || (canView && loadingList)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!ownerProfile) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="container py-8 px-4 text-center">
          <p className="text-muted-foreground mb-4">User not found.</p>
          <Button asChild>
            <Link to="/explore">Back to Explore</Link>
          </Button>
        </main>
      </div>
    );
  }

  const ownerLabel = ownerProfile.display_name || ownerProfile.username || 'this account';

  if (!canView) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="container py-8 px-4 max-w-3xl">
          <Button variant="ghost" size="sm" className="-ml-2 mb-4" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back
          </Button>
          <div className="text-center py-16 bg-card rounded-xl">
            <Lock className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
            <h3 className="text-lg font-medium mb-1">This account is private</h3>
            <p className="text-muted-foreground text-sm">Follow {ownerLabel} to see their lists.</p>
          </div>
        </main>
      </div>
    );
  }

  if (!list) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="container py-8 px-4 text-center">
          <p className="text-muted-foreground mb-4">List not found.</p>
          <Button asChild>
            <Link to={`/u/${userId}`}>Back to {ownerLabel}'s profile</Link>
          </Button>
        </main>
      </div>
    );
  }

  const hasValueSort = list.show_price || list.show_rating;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container py-4 sm:py-8 px-4 sm:px-6 lg:px-8 space-y-4 sm:space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(`/u/${userId}`)}>
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          {ownerLabel}'s profile
        </Button>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-11 h-11 rounded-lg flex items-center justify-center text-xl shrink-0"
              style={{ backgroundColor: `${list.color}22` }}
            >
              {list.icon}
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold truncate">{list.name}</h1>
              <p className="text-xs text-muted-foreground">
                {items.length} item{items.length === 1 ? '' : 's'} · by {ownerLabel}
              </p>
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder={`Search ${list.name.toLowerCase()}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {types.length > 0 && (
              <div className="mb-4">
                <ListTypesManager
                  listId={listId!}
                  types={types}
                  onTypesChange={() => {}}
                  modifyMode={false}
                  selectedTypeId={selectedTypeId}
                  onSelectType={setSelectedTypeId}
                />
              </div>
            )}

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'todo' | 'done')}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <TabsList>
                  <TabsTrigger value="todo" className="flex items-center gap-2">
                    <Circle className="h-4 w-4" />
                    {list.status_todo_label} ({todoItems.length})
                  </TabsTrigger>
                  <TabsTrigger value="done" className="flex items-center gap-2">
                    <Check className="h-4 w-4" />
                    {list.status_done_label} ({doneItems.length})
                  </TabsTrigger>
                </TabsList>

                <div className="flex items-center gap-2">
                  {hasValueSort && (
                    <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
                      <SelectTrigger className="w-[150px] h-9">
                        <SelectValue placeholder="Sort" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="name">Name (A-Z)</SelectItem>
                        {list.show_price && (
                          <>
                            <SelectItem value="price_asc">Price: Low to High</SelectItem>
                            <SelectItem value="price_desc">Price: High to Low</SelectItem>
                          </>
                        )}
                        {list.show_rating && (
                          <SelectItem value="rating_desc">Rating: High to Low</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  )}
                  <ListViewToggle value={viewMode} onChange={setViewMode} />
                </div>
              </div>

              <TabsContent value={activeTab}>
                {loadingItems ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : currentItems.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <span className="text-3xl mb-2 block opacity-50">{list.icon}</span>
                    <p>
                      {activeTab === 'todo'
                        ? `Nothing on their ${list.status_todo_label.toLowerCase()} list yet`
                        : `Nothing marked ${list.status_done_label.toLowerCase()} yet`}
                    </p>
                  </div>
                ) : viewMode === 'list' ? (
                  <div className="space-y-2">
                    {currentItems.map((item) => (
                      <CustomListItemRow key={item.id} item={item} list={list} onOpenDetail={() => {}} />
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-3 sm:gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
                    {currentItems.map((item) => (
                      <CustomListItemCard key={item.id} item={item} list={list} />
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {list.show_location && (
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="h-[250px] sm:h-[400px] relative">
                {mapboxLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : mapboxToken ? (
                  <PublicListMapComponent
                    token={mapboxToken}
                    items={currentItems}
                    focusedItemId={focusedItemId}
                    onFocusItem={setFocusedItemId}
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
        )}
      </main>
    </div>
  );
}

interface PublicListMapComponentProps {
  token: string;
  items: CustomListItem[];
  focusedItemId: string | null;
  onFocusItem: (id: string | null) => void;
  flyToRef: React.MutableRefObject<((lat: number, lng: number, itemId: string) => void) | null>;
}

// Same pin-building/pattern as CustomListDetail.tsx's CustomListMapComponent
// - duplicated rather than shared since that one isn't exported, and this
// view has no editing affordances to keep in sync with it.
function PublicListMapComponent({ token, items, focusedItemId, onFocusItem, flyToRef }: PublicListMapComponentProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<globalThis.Map<string, any>>(new globalThis.Map());
  const { center } = useMapCenter(items);

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

      flyToRef.current = (lat: number, lng: number, itemId: string) => {
        if (mapRef.current) {
          mapRef.current.flyTo({ center: [lng, lat], zoom: 16, duration: 1500, essential: true });
          const marker = markersRef.current.get(itemId);
          if (marker) marker.togglePopup();
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
    mapRef.current.easeTo({ center: [center.lng, center.lat], duration: 600 });
  }, [center]);

  useEffect(() => {
    if (!mapRef.current) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current.clear();

    const itemsWithLocation = items.filter((i) => i.latitude && i.longitude);
    if (itemsWithLocation.length === 0) return;

    const loadMarkers = async () => {
      const mapboxgl = (await import('mapbox-gl')).default;

      itemsWithLocation.forEach((item) => {
        const isFocused = focusedItemId === item.id;

        const el = createPinElement({
          color: item.type?.color,
          icon: item.type?.icon,
          focused: isFocused,
        });

        const safeName = item.name.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeAddress = item.address?.replace(/</g, '&lt;').replace(/>/g, '&gt;') || '';

        const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
          <div class="p-2">
            <h3 class="font-semibold">${safeName}</h3>
            ${safeAddress ? `<p class="text-sm text-gray-600">${safeAddress}</p>` : ''}
            ${getDirectionsPopupHtml({ latitude: item.latitude, longitude: item.longitude, address: item.address, name: item.name })}
          </div>
        `);

        const marker = new mapboxgl.Marker(el, { anchor: 'bottom' })
          .setLngLat([item.longitude!, item.latitude!])
          .setPopup(popup)
          .addTo(mapRef.current);

        el.addEventListener('click', () => onFocusItem(item.id));

        markersRef.current.set(item.id, marker);
      });

      if (itemsWithLocation.length > 0 && !focusedItemId) {
        const bounds = new mapboxgl.LngLatBounds();
        itemsWithLocation.forEach((i) => bounds.extend([i.longitude!, i.latitude!]));
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
  }, [items, focusedItemId, onFocusItem]);

  return <div ref={mapContainer} className="w-full h-full" />;
}
