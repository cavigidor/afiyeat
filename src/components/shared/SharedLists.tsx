import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { RestaurantCard } from '@/components/restaurants/RestaurantCard';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Plus, Users, Check, Clock, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { CreateSharedListDialog } from './CreateSharedListDialog';
import { AddSharedItemDialog } from './AddSharedItemDialog';
import { EditSharedItemDialog, SharedItem } from './EditSharedItemDialog';

interface Profile {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

interface SharedList {
  id: string;
  name: string;
  user_a: string;
  user_b: string;
  partner?: Profile | null;
}

interface SharedListsProps {
  following: Profile[];
}

export function SharedLists({ following }: SharedListsProps) {
  const { user } = useAuth();
  const [lists, setLists] = useState<SharedList[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [items, setItems] = useState<SharedItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [activeTab, setActiveTab] = useState<'to_go' | 'went_to'>('to_go');

  const [createOpen, setCreateOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<SharedItem | null>(null);
  const [deleteListId, setDeleteListId] = useState<string | null>(null);

  const selectedList = lists.find((l) => l.id === selectedListId) || null;

  const fetchLists = useCallback(async () => {
    if (!user) return;
    setLoadingLists(true);
    const { data, error } = await supabase
      .from('shared_lists')
      .select('id, name, user_a, user_b')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching shared lists:', error);
      setLoadingLists(false);
      return;
    }

    const rows = data || [];
    const partnerIds = rows.map((r) => (r.user_a === user.id ? r.user_b : r.user_a));
    let profilesById: Record<string, Profile> = {};
    if (partnerIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, user_id, username, display_name, avatar_url')
        .in('user_id', partnerIds);
      (profs || []).forEach((p) => {
        profilesById[p.user_id] = p;
      });
    }

    const withPartner: SharedList[] = rows.map((r) => {
      const partnerId = r.user_a === user.id ? r.user_b : r.user_a;
      return { ...r, partner: profilesById[partnerId] || null };
    });

    setLists(withPartner);
    setLoadingLists(false);
  }, [user]);

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  const fetchItems = useCallback(async () => {
    if (!selectedListId) {
      setItems([]);
      return;
    }
    setLoadingItems(true);
    const { data, error } = await supabase
      .from('shared_list_items')
      .select('id, name, address, status, rating, price_level, notes')
      .eq('list_id', selectedListId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching items:', error);
    } else {
      setItems(data || []);
    }
    setLoadingItems(false);
  }, [selectedListId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleMarkVisited = async (itemId: string) => {
    const { error } = await supabase
      .from('shared_list_items')
      .update({ status: 'went_to', visited_at: new Date().toISOString() })
      .eq('id', itemId);
    if (error) {
      toast.error('Failed to update');
    } else {
      toast.success('Marked as been there!');
      const updated = items.find((i) => i.id === itemId);
      fetchItems();
      if (updated) setEditItem({ ...updated, status: 'went_to' });
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    const { error } = await supabase.from('shared_list_items').delete().eq('id', itemId);
    if (error) {
      toast.error('Failed to delete');
    } else {
      toast.success('Place removed');
      fetchItems();
    }
  };

  const handleDeleteList = async () => {
    if (!deleteListId) return;
    const { error } = await supabase.from('shared_lists').delete().eq('id', deleteListId);
    if (error) {
      toast.error('Failed to delete list');
    } else {
      toast.success('Shared list deleted');
      if (selectedListId === deleteListId) setSelectedListId(null);
      setDeleteListId(null);
      fetchLists();
    }
  };

  const partnerLabel = (l: SharedList) =>
    l.partner?.display_name || l.partner?.username || 'a friend';

  const toGoList = items.filter((i) => i.status === 'to_go');
  const wentToList = items.filter((i) => i.status === 'went_to');
  const currentList = activeTab === 'to_go' ? toGoList : wentToList;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8">
      {/* Lists sidebar */}
      <div className="lg:col-span-1">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5" />
              Shared Lists
            </CardTitle>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">New</span>
            </Button>
          </CardHeader>
          <CardContent>
            {loadingLists ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : lists.length === 0 ? (
              <p className="text-center text-muted-foreground py-4 text-sm">
                No shared lists yet. Create one with a friend!
              </p>
            ) : (
              <div className="space-y-2">
                {lists.map((l) => (
                  <div
                    key={l.id}
                    className={`flex items-center gap-2 rounded-lg p-2 transition-colors ${
                      selectedListId === l.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                    }`}
                  >
                    <button
                      onClick={() => setSelectedListId(l.id)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={l.partner?.avatar_url || ''} />
                        <AvatarFallback
                          className={
                            selectedListId === l.id
                              ? 'bg-primary-foreground text-primary'
                              : 'bg-primary text-primary-foreground'
                          }
                        >
                          {partnerLabel(l)[0].toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{l.name}</p>
                        <p
                          className={`text-xs truncate ${
                            selectedListId === l.id ? 'text-primary-foreground/70' : 'text-muted-foreground'
                          }`}
                        >
                          with {partnerLabel(l)}
                        </p>
                      </div>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete shared list"
                      className={`h-8 w-8 shrink-0 ${
                        selectedListId === l.id ? 'hover:bg-primary-foreground/20' : ''
                      }`}
                      onClick={() => setDeleteListId(l.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Selected list view */}
      <div className="lg:col-span-2">
        {selectedList ? (
          <>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 sm:mb-6">
              <div>
                <h2 className="text-lg sm:text-xl font-bold">{selectedList.name}</h2>
                <p className="text-sm text-muted-foreground">
                  Shared with {partnerLabel(selectedList)} · {items.length} places
                </p>
              </div>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add Place
              </Button>
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

              <TabsContent value={activeTab}>
                {loadingItems ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : currentList.length === 0 ? (
                  <div className="text-center py-12 bg-card rounded-xl text-muted-foreground">
                    {activeTab === 'to_go' ? (
                      <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    ) : (
                      <Check className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    )}
                    <p>
                      {activeTab === 'to_go'
                        ? 'No places on the to-go list yet'
                        : "You haven't been anywhere together yet"}
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:gap-4 grid-cols-1 md:grid-cols-2">
                    {currentList.map((item) => (
                      <RestaurantCard
                        key={item.id}
                        restaurant={item}
                        onEdit={() => setEditItem(item)}
                        onDelete={() => handleDeleteItem(item.id)}
                        onMarkVisited={
                          item.status === 'to_go' ? () => handleMarkVisited(item.id) : undefined
                        }
                      />
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <div className="text-center py-12 bg-card rounded-xl">
            <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-2">Select a shared list</h3>
            <p className="text-muted-foreground">
              Pick a list on the left, or create one with a friend.
            </p>
          </div>
        )}
      </div>

      <CreateSharedListDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        following={following}
        onSuccess={fetchLists}
      />

      {selectedListId && (
        <AddSharedItemDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          listId={selectedListId}
          onSuccess={fetchItems}
        />
      )}

      <EditSharedItemDialog
        open={!!editItem}
        onOpenChange={(o) => !o && setEditItem(null)}
        item={editItem}
        onSuccess={fetchItems}
      />

      <AlertDialog open={!!deleteListId} onOpenChange={(o) => !o && setDeleteListId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this shared list?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the list and all of its places for both members. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteList}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
