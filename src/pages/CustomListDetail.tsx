import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { withApplePlaceDetails } from '@/lib/appleMaps';
import { ChevronLeft, Search, MoreHorizontal, Link2, Users, Lock, Globe, EyeOff, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { sharedListPath } from '@/lib/navigation';
import { toast } from 'sonner';
import { useMapCenter } from '@/hooks/useMapCenter';
import { PlaceMap, type MapPoint } from '@/components/maps/PlaceMap';
import { useFollowing } from '@/hooks/useFollowing';
import { CreateListDialog, type CustomList } from '@/components/lists/CreateListDialog';
import { AddCustomListItemDialog, type CustomListItem } from '@/components/lists/AddCustomListItemDialog';
import { ConvertToSharedListDialog } from '@/components/lists/ConvertToSharedListDialog';
import type { ManagedListType } from '@/hooks/useListTypeManagement';
import type { ManagedListStatus } from '@/hooks/useListStatusManagement';
import { getPriceSortValue, getRatingSortValue } from '@/lib/customListValues';
import { shareListLink } from '@/lib/shareList';
import { announceShareResult } from '@/lib/share';
import { useMyShareIdentity } from '@/hooks/useMyShareIdentity';
import { hapticWarning } from '@/lib/haptics';
import { LocationDeniedDialog } from '@/components/shared/LocationDeniedDialog';
import { NearMeButton } from '@/components/shared/NearMeButton';
import { Spinner } from '@/components/ui/spinner';
import { useDeviceSetting } from '@/hooks/useDeviceSetting';
import { defaultViewOf, layoutOf, nounOf, presetForIcon, viewsFor, type ListView } from '@/lib/listPresets';
import { ListGlyph } from '@/components/lists/v2/ListGlyph';
import { CategoryChips, SortChip, StatusSegments, ViewMenu, type SortKey } from '@/components/lists/v2/ListControls';
import { ItemCard, ItemRow } from '@/components/lists/v2/ListItems';
import { categoriesOf, groupByCategory } from '@/lib/listItemDisplay';
import { QuickAddBar, QuickAddSheet } from '@/components/lists/v2/QuickAdd';
import { ItemSheet } from '@/components/lists/v2/ItemSheet';
import { CustomizeSheet } from '@/components/lists/v2/CustomizeSheet';
import { cn } from '@/lib/utils';
import { detailSummary, fetchListFields, fetchListValues } from '@/lib/itemDetails';



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
    .select(
      '*, images:custom_list_item_images(id, image_url), status:custom_list_statuses(id, name, sort_order)',
    )
    .eq('list_id', listId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return withApplePlaceDetails((data || []) as CustomListItem[]);
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

async function fetchStatuses(listId: string): Promise<ManagedListStatus[]> {
  const { data, error } = await supabase
    .from('custom_list_statuses')
    .select('*')
    .eq('list_id', listId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

const isView = (v: string): v is ListView => v === 'list' || v === 'cards' || v === 'grouped' || v === 'map';
const isSort = (v: string): v is SortKey => ['recent', 'name', 'rating', 'price_asc', 'price_desc'].includes(v);
const NO_CATEGORY = '__none__';

export default function CustomListDetail() {
  const { listId } = useParams<{ listId: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<CustomListItem | null>(null);
  const [pendingEditId, setPendingEditId] = useState<string | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [sheetItemId, setSheetItemId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<CustomListItem | null>(null);
  const [deleteListOpen, setDeleteListOpen] = useState(false);
  const [activeStatusId, setActiveStatusId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const mapFlyToRef = useRef<((lat: number, lng: number, itemId: string) => void) | null>(null);
  const mapFlyToMeRef = useRef<(() => void) | null>(null);
  const [locationDeniedOpen, setLocationDeniedOpen] = useState(false);

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

  const { data: statuses = [] } = useQuery({
    queryKey: ['custom_list_statuses', listId],
    queryFn: () => fetchStatuses(listId!),
    enabled: !!listId,
  });

  // Preset fields (owner-only). When the tables aren't there, `available` is false and nothing changes.
  const { data: fieldsState } = useQuery({
    queryKey: ['custom_list_fields', listId],
    queryFn: () => fetchListFields(listId!),
    enabled: !!listId && !!list,
    staleTime: 60_000,
  });
  const listFields = fieldsState?.available ? fieldsState.fields : null;
  const valuesQuery = useQuery({
    queryKey: ['custom_list_values', listId],
    queryFn: () => fetchListValues(listId!),
    enabled: !!listId && !!listFields?.length,
  });
  const itemValues = valuesQuery.data ?? {};
  // The editor only offers details once the saved values are in, so saving can't overwrite ones it hasn't seen.
  const editorFields = listFields?.length && valuesQuery.isSuccess ? listFields : null;

  const sortedStatuses = useMemo(
    () =>
      [...statuses].sort((a, b) => {
        const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
        const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return a.name.localeCompare(b.name);
      }),
    [statuses],
  );

  useEffect(() => {
    if (sortedStatuses.length === 0) return;
    if (!activeStatusId || !sortedStatuses.some((s) => s.id === activeStatusId)) {
      setActiveStatusId(sortedStatuses[0].id);
    }
  }, [sortedStatuses, activeStatusId]);

  // A category that was deleted (or renamed away) shouldn't leave the list filtered to nothing.
  useEffect(() => {
    if (categoryId && categoryId !== NO_CATEGORY && !types.some((t) => t.id === categoryId)) setCategoryId(null);
  }, [types, categoryId]);

  // View and sort are remembered per list, on this device.
  const isV2Preset = !!list && !!presetForIcon(list.icon) && ['🍽️', '🍸', '🫘', '☕', '🛍️', '🌍'].includes(list.icon);
  const [storedView, setView] = useDeviceSetting<ListView>(`list-view-${listId}`, list ? defaultViewOf(list) : 'list', isView);
  const [sortBy, setSortBy] = useDeviceSetting<SortKey>(`list-sort-${listId}`, isV2Preset ? 'recent' : 'name', isSort);

  const { data: following = [] } = useFollowing(user?.id);
  const shareIdentity = useMyShareIdentity();

  const handleShareLink = async () => {
    if (!user || !list) return;
    const result = await shareListLink(user.id, list.id, list.name, shareIdentity.referralCode);
    announceShareResult(result, { privateProfile: shareIdentity.isPrivate });
  };

  const invalidateItems = () => {
    queryClient.invalidateQueries({ queryKey: ['custom_list_items', listId] });
    queryClient.invalidateQueries({ queryKey: ['custom_list_values', listId] });
    queryClient.invalidateQueries({ queryKey: ['custom_list_item_counts', user?.id] });
  };
  const invalidateList = () => {
    queryClient.invalidateQueries({ queryKey: ['custom_list', listId, user?.id] });
    queryClient.invalidateQueries({ queryKey: ['custom_lists', user?.id] });
  };
  const invalidateTypes = () => {
    queryClient.invalidateQueries({ queryKey: ['custom_list_types', listId] });
    invalidateItems();
  };
  const invalidateStatuses = () => {
    queryClient.invalidateQueries({ queryKey: ['custom_list_statuses', listId] });
    invalidateItems();
  };

  // "Save and add details": open the editor once the new item is in the refetched items.
  useEffect(() => {
    if (!pendingEditId) return;
    const found = items.find((i) => i.id === pendingEditId);
    if (found) { setEditItem(found); setEditOpen(true); setPendingEditId(null); }
  }, [items, pendingEditId]);

  // Search and category apply to every status; the status tabs show what's left in each.
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const result = items
      .filter((i) => {
        if (!categoryId) return true;
        const cats = categoriesOf(i, types);
        return categoryId === NO_CATEGORY ? cats.length === 0 : cats.some((c) => c.id === categoryId);
      })
      .filter((i) => !q || i.name.toLowerCase().includes(q) || i.address?.toLowerCase().includes(q) || i.notes?.toLowerCase().includes(q));
    if (!list) return result;
    const byName = (a: CustomListItem, b: CustomListItem) => a.name.localeCompare(b.name);
    return [...result].sort((a, b) => {
      switch (sortBy) {
        case 'recent': return (b.created_at ?? '').localeCompare(a.created_at ?? '') || byName(a, b);
        // Unrated and unpriced items go last, not first, whichever way the list is sorted.
        case 'rating': return (getRatingSortValue(b, list) ?? -Infinity) - (getRatingSortValue(a, list) ?? -Infinity) || byName(a, b);
        case 'price_asc': return (getPriceSortValue(a, list) ?? Infinity) - (getPriceSortValue(b, list) ?? Infinity) || byName(a, b);
        case 'price_desc': return (getPriceSortValue(b, list) ?? -Infinity) - (getPriceSortValue(a, list) ?? -Infinity) || byName(a, b);
        default: return byName(a, b);
      }
    });
  }, [items, types, categoryId, searchQuery, sortBy, list]);

  const currentItems = useMemo(() => filteredItems.filter((i) => i.status_id === activeStatusId), [filteredItems, activeStatusId]);

  const handleMove = async (item: CustomListItem, statusId: string) => {
    const { error } = await supabase.from('custom_list_items').update({ status_id: statusId }).eq('id', item.id);
    if (error) {
      toast.error('Couldn’t move it. Check your connection and try again.');
      return false;
    }
    const target = sortedStatuses.find((s) => s.id === statusId);
    toast.success(target ? `Moved to ${target.name}` : 'Updated');
    invalidateItems();
    return true;
  };

  const handleDeleteItem = async () => {
    if (!deleteItem) return;
    const { error } = await supabase.from('custom_list_items').delete().eq('id', deleteItem.id);
    if (error) {
      toast.error('Couldn’t delete it. Check your connection and try again.');
    } else {
      void hapticWarning();
      toast.success(`${deleteItem.name} deleted`);
      setSheetItemId(null);
      invalidateItems();
    }
    setDeleteItem(null);
  };

  const handleDeleteList = async () => {
    if (!list) return;
    const { error } = await supabase.from('custom_lists').delete().eq('id', list.id);
    if (error) {
      toast.error('Couldn’t delete the list. Check your connection and try again.');
      return;
    }
    toast.success(`${list.name} deleted`);
    queryClient.invalidateQueries({ queryKey: ['custom_lists', user?.id] });
    queryClient.invalidateQueries({ queryKey: ['custom_list_item_counts', user?.id] });
    navigate('/my-lists');
  };

  if (authLoading || loadingList) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="h-8 w-8 animate-spin text-primary" />
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
            <Link to="/my-lists">Back to Lists</Link>
          </Button>
        </main>
      </div>
    );
  }

  const layout = layoutOf(list);
  const noun = nounOf(list);
  const viewOptions = viewsFor(list, {
    categories: types.length,
    withPhotos: items.filter((i) => (i.images?.length ?? 0) > 0).length,
    withCoords: items.filter((i) => i.latitude != null && i.longitude != null).length,
  });
  // A remembered view that this list can't show right now (e.g. Map after Location was turned off) falls back to List.
  const view: ListView = viewOptions.find((o) => o.view === storedView)?.available ? storedView : 'list';
  const sheetItem = items.find((i) => i.id === sheetItemId) ?? null;

  const segments = sortedStatuses.map((s) => ({ id: s.id, label: s.name, count: filteredItems.filter((i) => i.status_id === s.id).length }));
  const summary = items.length === 0
    ? `No ${noun.many} yet`
    : sortedStatuses.map((s) => `${items.filter((i) => i.status_id === s.id).length} ${s.name.toLowerCase()}`).join(' · ');
  const uncategorized = items.some((i) => categoriesOf(i, types).length === 0);
  const chips = [
    ...types.map((t) => ({ id: t.id, label: t.name, icon: t.icon })),
    ...(types.length > 0 && uncategorized ? [{ id: NO_CATEGORY, label: layout === 'travel' ? 'Not grouped yet' : 'No category' }] : []),
  ];
  const sortOptions: { key: SortKey; label: string }[] = [
    { key: 'recent', label: 'Recently added' },
    { key: 'name', label: 'Name A–Z' },
    ...(list.show_rating ? [{ key: 'rating' as const, label: 'Highest rated' }] : []),
    ...(list.show_price ? [{ key: 'price_asc' as const, label: 'Price: low to high' }, { key: 'price_desc' as const, label: 'Price: high to low' }] : []),
  ];
  const audience = list.visibility === 'private'
    ? { Icon: Lock, label: 'Only me' }
    : list.visibility === 'anonymous'
      ? { Icon: EyeOff, label: 'Anonymous' }
      : shareIdentity.isPrivate ? { Icon: Users, label: 'Followers' } : { Icon: Globe, label: 'Everyone' };
  const activeStatus = sortedStatuses.find((s) => s.id === activeStatusId);
  const openItem = (item: CustomListItem) => setSheetItemId(item.id);
  const emptyText = searchQuery.trim()
    ? `Nothing matches “${searchQuery.trim()}”`
    : categoryId
      ? `Nothing ${activeStatus ? activeStatus.name.toLowerCase() : ''} in this category`
      : items.length === 0
        ? `Add your first ${noun.one} below`
        : `Nothing ${activeStatus ? activeStatus.name.toLowerCase() : ''} yet`;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container px-4 pt-2 sm:px-6 lg:px-8 pb-[calc(56px+env(safe-area-inset-bottom,0px)+96px)] md:pb-28">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" className="-ml-2 gap-1 px-2" onClick={() => navigate('/my-lists')}>
            <ChevronLeft className="h-5 w-5" />
            Lists
          </Button>
          <div className="flex items-center">
            <Button variant="ghost" size="icon" aria-label={searchOpen ? 'Close search' : `Search ${list.name}`} aria-pressed={searchOpen}
              onClick={() => { setSearchOpen((o) => !o); if (searchOpen) setSearchQuery(''); }}>
              {searchOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="List options">
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem onClick={() => setCustomizeOpen(true)}>
                  <SlidersHorizontal className="mr-2 h-4 w-4" />Customize list
                </DropdownMenuItem>
                {(list.visibility ?? 'profile') === 'profile' ? (
                  <DropdownMenuItem onClick={handleShareLink}>
                    <Link2 className="mr-2 h-4 w-4" />Share link
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem disabled className="whitespace-normal text-xs">Links are only for lists shown on your profile.</DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setConvertOpen(true)}>
                  <Users className="mr-2 h-4 w-4" />Make a shared list with a friend
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setDeleteListOpen(true)} className="text-destructive focus:text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />Delete list
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-1 flex items-center gap-3">
          <ListGlyph icon={list.icon} color={list.color} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold leading-tight tracking-tight line-clamp-2 [overflow-wrap:anywhere]">{list.name}</h1>
            <p className="truncate text-sm text-muted-foreground">{summary}</p>
          </div>
          <button type="button" onClick={() => setCustomizeOpen(true)} aria-label={`Who can see this list: ${audience.label}. Change`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-semibold active-press">
            <audience.Icon className="h-3.5 w-3.5" />
            <span className="hidden min-[360px]:inline">{audience.label}</span>
          </button>
        </div>
        {list.visibility === 'anonymous' && list.discovery_token && (
          <Link to={`/lists/discover/${list.discovery_token}`} className="mt-1 inline-block text-xs text-primary underline-offset-2 hover:underline">
            See what others see
          </Link>
        )}

        {searchOpen && (
          <div className="mt-3 flex h-11 items-center gap-2 rounded-xl border bg-card px-3 animate-in fade-in-0 slide-in-from-top-1 duration-150">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input autoFocus value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={`Search ${list.name}`}
              aria-label={`Search ${list.name}`} className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" />
          </div>
        )}

        <div className="mt-4 space-y-3">
          {segments.length > 0 && <StatusSegments segments={segments} value={activeStatusId} onChange={setActiveStatusId} />}
          {chips.length > 0 ? (
            <CategoryChips chips={chips} value={categoryId} onChange={setCategoryId}
              trailing={sortOptions.length > 1 ? <SortChip value={sortBy} onChange={setSortBy} options={sortOptions} /> : undefined} />
          ) : sortOptions.length > 1 ? (
            <div className="flex justify-end"><SortChip value={sortBy} onChange={setSortBy} options={sortOptions} /></div>
          ) : null}
        </div>

        <div className="mt-3">
          {loadingItems ? (
            <div className="flex justify-center py-12"><Spinner className="h-6 w-6 animate-spin text-primary" /></div>
          ) : view === 'map' ? (
            <div className="space-y-3">
              <div className="relative h-[52vh] min-h-[280px] overflow-hidden rounded-2xl border">
                <CustomListMapComponent
                  items={currentItems}
                  types={types}
                  focusedItemId={focusedItemId}
                  onFocusItem={setFocusedItemId}
                  flyToRef={mapFlyToRef}
                  flyToMeRef={mapFlyToMeRef}
                  onLocationDenied={() => setLocationDeniedOpen(true)}
                />
                <NearMeButton onClick={() => mapFlyToMeRef.current?.()} />
              </div>
              <div className="divide-y">
                {currentItems.map((item) => (
                  <div key={item.id} className={cn(item.id === focusedItemId && 'bg-primary/5')}>
                    <ItemRow item={item} list={list} types={types} onOpen={() => openItem(item)} detail={detailSummary(listFields, itemValues[item.id])} />
                  </div>
                ))}
              </div>
            </div>
          ) : currentItems.length === 0 ? (
            <div className="flex flex-col items-center py-14 text-center text-muted-foreground animate-in fade-in-0 duration-300">
              <ListGlyph icon={list.icon} color={list.color} size="lg" className="mb-3 opacity-80" />
              <p>{emptyText}</p>
            </div>
          ) : view === 'cards' ? (
            <div key={`cards-${activeStatusId}-${categoryId}`} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 animate-in fade-in-0 duration-200">
              {currentItems.map((item) => <ItemCard key={item.id} item={item} list={list} types={types} onOpen={() => openItem(item)} />)}
            </div>
          ) : view === 'grouped' ? (
            <div key={`grouped-${activeStatusId}`} className="space-y-4 animate-in fade-in-0 duration-200">
              {groupByCategory(currentItems, types, layout === 'travel' ? 'Not grouped yet' : 'No category').map((g) => (
                <section key={g.key} aria-label={g.title}>
                  <h2 className="sticky top-0 z-10 -mx-4 flex items-center justify-between bg-background/95 px-4 py-2 text-sm font-semibold backdrop-blur">
                    <span className="truncate">{g.title}</span>
                    <span className="tabular-nums text-muted-foreground">{g.items.length}</span>
                  </h2>
                  <div className="divide-y">
                    {g.items.map((item) => <ItemRow key={item.id} item={item} list={list} types={types} onOpen={() => openItem(item)} detail={detailSummary(listFields, itemValues[item.id])} />)}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div key={`list-${activeStatusId}-${categoryId}`} className="divide-y animate-in fade-in-0 duration-200">
              {currentItems.map((item) => <ItemRow key={item.id} item={item} list={list} types={types} onOpen={() => openItem(item)} detail={detailSummary(listFields, itemValues[item.id])} />)}
            </div>
          )}
        </div>
      </main>

      <QuickAddBar list={list} onOpen={() => setQuickAddOpen(true)}>
        <ViewMenu options={viewOptions} value={view} onChange={setView} />
      </QuickAddBar>

      <QuickAddSheet
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        list={list}
        types={types}
        statuses={sortedStatuses}
        statusId={activeStatusId}
        categoryId={categoryId && categoryId !== NO_CATEGORY ? categoryId : null}
        onSaved={() => invalidateItems()}
        onSavedOpenDetails={(id) => setPendingEditId(id)}
      />

      <ItemSheet
        item={sheetItem}
        list={list}
        types={types}
        statuses={sortedStatuses}
        onClose={() => setSheetItemId(null)}
        onEdit={(item) => { setSheetItemId(null); setEditItem(item); setEditOpen(true); }}
        onDelete={(item) => setDeleteItem(item)}
        onMove={handleMove}
        fields={listFields}
        values={sheetItem ? itemValues[sheetItem.id] : undefined}
      />

      <AddCustomListItemDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        list={list}
        types={types}
        statuses={sortedStatuses}
        onSuccess={invalidateItems}
        editItem={editItem}
        fields={editorFields}
        itemValues={editItem ? itemValues[editItem.id] : undefined}
      />

      <CustomizeSheet
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        list={list}
        types={types}
        statuses={sortedStatuses}
        view={view}
        viewOptions={viewOptions}
        onViewChange={setView}
        onListChanged={invalidateList}
        onTypesChanged={invalidateTypes}
        onStatusesChanged={invalidateStatuses}
        onOpenAllSettings={() => { setCustomizeOpen(false); setSettingsOpen(true); }}
        fieldsState={fieldsState}
        onFieldsChanged={() => queryClient.invalidateQueries({ queryKey: ['custom_list_fields', listId] })}
      />

      <CreateListDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSuccess={invalidateList}
        editList={list}
      />

      <ConvertToSharedListDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        list={list}
        items={items}
        statuses={sortedStatuses}
        following={following}
        onSuccess={(newListId) => navigate(sharedListPath(newListId))}
      />

      <AlertDialog open={!!deleteItem} onOpenChange={(o) => !o && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteItem?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This removes it and its photos from {list.name}. This can’t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteItem} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteListOpen} onOpenChange={setDeleteListOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {list.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the list and its {items.length} {items.length === 1 ? noun.one : noun.many}, with their photos. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteList} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete list</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LocationDeniedDialog open={locationDeniedOpen} onOpenChange={setLocationDeniedOpen} />
    </div>
  );
}

interface CustomListMapComponentProps {
  items: CustomListItem[];
  types: ManagedListType[];
  focusedItemId: string | null;
  onFocusItem: (id: string | null) => void;
  flyToRef: React.MutableRefObject<((lat: number, lng: number, itemId: string) => void) | null>;
  flyToMeRef: React.MutableRefObject<(() => void) | null>;
  onLocationDenied: () => void;
}

// Pins are coloured and emoji-tagged by the item's first assigned type, so a
// list with several types is easy to scan. An item can carry more than one
// type, but a pin shows one: the first (by sort_order) wins.
function CustomListMapComponent({ items, types, focusedItemId, onFocusItem, flyToRef, flyToMeRef, onLocationDenied }: CustomListMapComponentProps) {
  const { center } = useMapCenter(items);
  const points = useMemo<MapPoint[]>(
    () =>
      items.map((item) => {
        const firstType = types.find((t) => (item.type_ids || []).includes(t.id));
        return {
          id: item.id,
          name: item.name,
          address: item.address,
          latitude: item.latitude,
          longitude: item.longitude,
          color: firstType?.color,
          icon: firstType?.icon,
        };
      }),
    [items, types],
  );
  return (
    <PlaceMap
      points={points}
      center={center}
      focusedId={focusedItemId}
      onSelect={onFocusItem}
      flyToRef={flyToRef}
      flyToMeRef={flyToMeRef}
      onLocationDenied={onLocationDenied}
    />
  );
}
