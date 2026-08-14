import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Plus, Search, Pencil, Settings, ArrowLeft, Circle, Check, Map } from 'lucide-react';
import { toast } from 'sonner';
import { useViewMode } from '@/hooks/useViewMode';
import { useMapCenter } from '@/hooks/useMapCenter';
import { ListViewToggle } from '@/components/shared/ListViewToggle';
import { CreateListDialog, type CustomList } from '@/components/lists/CreateListDialog';
import { AddCustomListItemDialog, type CustomListItem } from '@/components/lists/AddCustomListItemDialog';
import { CustomListItemRow } from '@/components/lists/CustomListItemRow';
import { CustomListItemCard } from '@/components/lists/CustomListItemCard';
import { ListTypesManager } from '@/components/lists/ListTypesManager';
import type { ManagedListType } from '@/hooks/useListTypeManagement';
import { getPriceSortValue, getRatingSortValue } from '@/lib/customListValues';
import { getDirectionsPopupHtml } from '@/lib/directions';
import { createPinElement } from '@/lib/mapPin';

type SortBy = 'name' | 'price_asc' | 'price_desc' | 'rating_desc';

async function fetchMapboxTokenValue(): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('get-mapbox-token');
  if (error) throw error;
  return data?.token ?? null;
}

async function fetchList(listId: string, userId: string): Promise<CustomList | null> {
  const { data, error } = await supabase
    .from('custom_lists')
    .select('*')
    .eq('id', listId)
    .eq('user_id', userId)
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

export default function CustomListDetail() {
  const { listId } = useParams<{ listId: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<CustomListItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'todo' | 'done'>('todo');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [modifyMode, setModifyMode] = useState(false);
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useViewMode(`custom-list-${listId}`);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const mapFlyToRef = useRef<((lat: number, lng: number, itemId: string) => void) | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [user, authLoading, navigate]);

  const { data: list, isLoading: loadingList } = useQuery({
    queryKey: ['custom_list', listId, user?.id],
    queryFn: () => fetchList(listId!, user!.id),
    enabled: !!user && !!listId,
  });

  const { data: items = [], isLoading: loadingItems } = useQuery({
    queryKey: ['custom_list_items', listId],
    queryFn: () => fetchItems(listId!),
    enabled: !!listId && !!list,
  });

  const { data: types = [] } = useQuery({
    queryKey: ['custom_list_types', listId],
    queryFn: () => fetchTypes(listId!),
    enabled: !!listId,
  });

  const { data: mapboxToken, isLoading: mapboxLoading } = useQuery({
    queryKey: ['mapbox-token'],
    queryFn: fetchMapboxTokenValue,
    enabled: !!user && !!list?.show_location,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const invalidateItems = () => {
    queryClient.invalidateQueries({ queryKey: ['custom_list_items', listId] });
    queryClient.invalidateQueries({ queryKey: ['custom_list_item_counts', user?.id] });
  };
  const invalidateList = () => queryClient.invalidateQueries({ queryKey: ['custom_list', listId, user?.id] });
  const invalidateTypes = () => {
    queryClient.invalidateQueries({ queryKey: ['custom_list_types', listId] });
    invalidateItems();
  };

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

  const handleToggleStatus = async (item: CustomListItem) => {
    const { error } = await supabase
      .from('custom_list_items')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', item.id);
    if (error) {
      toast.error('Failed to update');
    } else {
      toast.success(`Marked as ${list!.status_done_label}!`);
      invalidateItems();
    }
  };

  const handleDelete = async (itemId: string) => {
    const { error } = await supabase.from('custom_list_items').delete().eq('id', itemId);
    if (error) {
      toast.error('Failed to delete');
    } else {
      toast.success('Item deleted');
      invalidateItems();
    }
    setDeleteItemId(null);
  };

  if (authLoading || loadingList) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
            <Link to="/my-lists">Back to My Lists</Link>
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
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate('/my-lists')}>
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          My Lists
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
              <p className="text-xs text-muted-foreground">{items.length} item{items.length === 1 ? '' : 's'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="icon" aria-label="List settings" onClick={() => setSettingsOpen(true)}>
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              variant={modifyMode ? 'default' : 'outline'}
              size="sm"
              onClick={() => setModifyMode((m) => !m)}
            >
              <Pencil className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">{modifyMode ? 'Done' : 'Modify'}</span>
            </Button>
            <Button onClick={() => { setEditItem(null); setAddOpen(true); }} size="sm">
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Add Item</span>
            </Button>
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

            <div className="mb-4">
              <ListTypesManager
                listId={listId!}
                types={types}
                onTypesChange={invalidateTypes}
                modifyMode={modifyMode}
                selectedTypeId={selectedTypeId}
                onSelectType={setSelectedTypeId}
              />
            </div>

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
                        ? `Nothing on your ${list.status_todo_label.toLowerCase()} list yet`
                        : `Nothing marked ${list.status_done_label.toLowerCase()} yet`}
                    </p>
                  </div>
                ) : viewMode === 'list' ? (
                  <div className="space-y-2">
                    {currentItems.map((item) => (
                      <CustomListItemRow
                        key={item.id}
                        item={item}
                        list={list}
                        onOpenDetail={() => {
                          if (modifyMode) return;
                          setEditItem(item);
                          setAddOpen(true);
                        }}
                        onEdit={() => { setEditItem(item); setAddOpen(true); }}
                        onDelete={() => setDeleteItemId(item.id)}
                        onToggleStatus={item.status === 'todo' ? () => handleToggleStatus(item) : undefined}
                        quickDelete={modifyMode}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-3 sm:gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
                    {currentItems.map((item) => (
                      <div
                        key={item.id}
                        onClick={modifyMode ? undefined : () => { setEditItem(item); setAddOpen(true); }}
                        className={modifyMode ? '' : 'cursor-pointer'}
                      >
                        <CustomListItemCard
                          item={item}
                          list={list}
                          onEdit={() => { setEditItem(item); setAddOpen(true); }}
                          onDelete={() => setDeleteItemId(item.id)}
                          onToggleStatus={item.status === 'todo' ? () => handleToggleStatus(item) : undefined}
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

        {list.show_location && (
          <Card className="overflow-hidden" ref={mapRef}>
            <CardContent className="p-0">
              <div className="h-[250px] sm:h-[400px] relative">
                {mapboxLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : mapboxToken ? (
                  <CustomListMapComponent
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

      <AddCustomListItemDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        list={list}
        types={types}
        onSuccess={invalidateItems}
        editItem={editItem}
      />

      <CreateListDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSuccess={invalidateList}
        editList={list}
      />

      <AlertDialog open={!!deleteItemId} onOpenChange={(o) => !o && setDeleteItemId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteItemId && handleDelete(deleteItemId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface CustomListMapComponentProps {
  token: string;
  items: CustomListItem[];
  focusedItemId: string | null;
  onFocusItem: (id: string | null) => void;
  flyToRef: React.MutableRefObject<((lat: number, lng: number, itemId: string) => void) | null>;
}

// Same pattern as MyList.tsx's MapComponent - pins are colored and
// emoji-tagged by the item's type (see createPinElement) so a list with
// several types is easy to scan at a glance.
function CustomListMapComponent({ token, items, focusedItemId, onFocusItem, flyToRef }: CustomListMapComponentProps) {
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
