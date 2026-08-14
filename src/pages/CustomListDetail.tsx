import { useState, useEffect, useMemo } from 'react';
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
import { Loader2, Plus, Search, Pencil, Settings, ArrowLeft, Circle, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useViewMode } from '@/hooks/useViewMode';
import { ListViewToggle } from '@/components/shared/ListViewToggle';
import { CreateListDialog, type CustomList } from '@/components/lists/CreateListDialog';
import { AddCustomListItemDialog, type CustomListItem } from '@/components/lists/AddCustomListItemDialog';
import { CustomListItemRow } from '@/components/lists/CustomListItemRow';
import { CustomListItemCard } from '@/components/lists/CustomListItemCard';

type SortBy = 'name' | 'price_asc' | 'price_desc' | 'rating_desc';

async function fetchList(listId: string, userId: string): Promise<CustomList | null> {
  const { data, error } = await supabase
    .from('custom_lists')
    .select('*')
    .eq('id', listId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as CustomList | null;
}

async function fetchItems(listId: string): Promise<CustomListItem[]> {
  const { data, error } = await supabase
    .from('custom_list_items')
    .select('*, images:custom_list_item_images(id, image_url)')
    .eq('list_id', listId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as CustomListItem[];
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
  const [viewMode, setViewMode] = useViewMode(`custom-list-${listId}`);

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

  const invalidateItems = () => {
    queryClient.invalidateQueries({ queryKey: ['custom_list_items', listId] });
    queryClient.invalidateQueries({ queryKey: ['custom_list_item_counts', user?.id] });
  };
  const invalidateList = () => queryClient.invalidateQueries({ queryKey: ['custom_list', listId, user?.id] });

  const filteredItems = useMemo(
    () =>
      items
        .filter((i) => {
          if (!searchQuery.trim()) return true;
          const q = searchQuery.toLowerCase();
          return i.name.toLowerCase().includes(q) || i.address?.toLowerCase().includes(q);
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
    [items, searchQuery, sortBy],
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
      </main>

      <AddCustomListItemDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        list={list}
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
