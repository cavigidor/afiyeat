import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Plus, ListChecks, Settings, Trash2, UtensilsCrossed, ListPlus, Users, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { CreateListDialog, type CustomList } from '@/components/lists/CreateListDialog';
import { CreateSharedListDialog } from '@/components/shared/CreateSharedListDialog';
import { AnimalAvatar } from '@/components/shared/AnimalAvatar';
import { useFollowing } from '@/hooks/useFollowing';

async function fetchMyLists(userId: string): Promise<CustomList[]> {
  const { data, error } = await supabase
    .from('custom_lists')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as CustomList[];
}

// My Restaurants predates custom_lists (it's the app's original, flagship
// feature) and still lives in its own table/page rather than being a
// custom_lists row - this just gets its count so the pinned card below can
// show one alongside the real custom lists.
async function fetchRestaurantCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('restaurants')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) throw error;
  return count || 0;
}

// One lightweight query for every item's list_id (rather than one COUNT
// query per list) - fine at personal-list scale, and keeps this to a single
// round trip no matter how many lists someone creates.
async function fetchItemCounts(userId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('custom_list_items')
    .select('list_id')
    .eq('user_id', userId);
  if (error) throw error;
  const counts: Record<string, number> = {};
  (data || []).forEach((row) => {
    counts[row.list_id] = (counts[row.list_id] || 0) + 1;
  });
  return counts;
}

interface SharedListPreview {
  id: string;
  name: string;
  partner: {
    display_name: string | null;
    username: string | null;
    avatar_emoji: string;
    avatar_color: string;
  } | null;
}

// Lightweight version of SharedLists.tsx's own fetch - just enough to show
// a preview card here (name + partner), full item lists still live on the
// Friends > Shared Lists tab.
async function fetchSharedLists(userId: string): Promise<SharedListPreview[]> {
  const { data, error } = await supabase
    .from('shared_lists')
    .select('id, name, user_a, user_b')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) return [];

  const partnerIds = Array.from(new Set(rows.map((r) => (r.user_a === userId ? r.user_b : r.user_a))));
  const { data: profs } = await supabase
    .from('profiles')
    .select('user_id, display_name, username, avatar_emoji, avatar_color')
    .in('user_id', partnerIds);
  const byId: Record<string, SharedListPreview['partner']> = {};
  (profs || []).forEach((p) => {
    byId[p.user_id] = p;
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    partner: byId[r.user_a === userId ? r.user_b : r.user_a] || null,
  }));
}

export default function MyLists() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [createSharedOpen, setCreateSharedOpen] = useState(false);
  const [editList, setEditList] = useState<CustomList | null>(null);
  const [deleteListId, setDeleteListId] = useState<string | null>(null);
  const [deleteRestaurantsOpen, setDeleteRestaurantsOpen] = useState(false);
  const [deletingRestaurants, setDeletingRestaurants] = useState(false);

  const { data: following = [] } = useFollowing(user?.id);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  const { data: lists = [], isLoading: loadingLists } = useQuery({
    queryKey: ['custom_lists', user?.id],
    queryFn: () => fetchMyLists(user!.id),
    enabled: !!user,
  });

  const { data: itemCounts = {} } = useQuery({
    queryKey: ['custom_list_item_counts', user?.id],
    queryFn: () => fetchItemCounts(user!.id),
    enabled: !!user,
  });

  const { data: restaurantCount = 0 } = useQuery({
    queryKey: ['restaurant_count', user?.id],
    queryFn: () => fetchRestaurantCount(user!.id),
    enabled: !!user,
  });

  const { data: sharedLists = [] } = useQuery({
    queryKey: ['shared_lists_preview', user?.id],
    queryFn: () => fetchSharedLists(user!.id),
    enabled: !!user,
  });

  const invalidateLists = () => {
    queryClient.invalidateQueries({ queryKey: ['custom_lists', user?.id] });
    queryClient.invalidateQueries({ queryKey: ['custom_list_item_counts', user?.id] });
  };

  const invalidateSharedLists = () =>
    queryClient.invalidateQueries({ queryKey: ['shared_lists_preview', user?.id] });

  const handleDeleteList = async () => {
    if (!deleteListId) return;
    const { error } = await supabase.from('custom_lists').delete().eq('id', deleteListId);
    if (error) {
      toast.error('Failed to delete list');
    } else {
      toast.success('List deleted');
      setDeleteListId(null);
      invalidateLists();
    }
  };

  // My Restaurants isn't a custom_lists row - it's the entire restaurants
  // table for this user - so "deleting the list" here means deleting every
  // restaurant in it, not un-pinning a wrapper. Restaurant photos in
  // Storage aren't cleaned up here, matching the existing single-restaurant
  // delete flow in MyList.tsx, which doesn't do that either.
  const handleDeleteRestaurants = async () => {
    if (!user) return;
    setDeletingRestaurants(true);
    const { error } = await supabase.from('restaurants').delete().eq('user_id', user.id);
    setDeletingRestaurants(false);
    if (error) {
      toast.error('Failed to delete My Restaurants');
    } else {
      toast.success('My Restaurants cleared');
      setDeleteRestaurantsOpen(false);
      queryClient.invalidateQueries({ queryKey: ['restaurant_count', user.id] });
      queryClient.invalidateQueries({ queryKey: ['restaurants', user.id] });
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
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">My Lists</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Everything you're tracking - your restaurants, and any custom list you create.
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="sm:size-default shrink-0">
                <Plus className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Create New List</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { setEditList(null); setCreateOpen(true); }}>
                <ListPlus className="h-4 w-4 mr-2" />
                Personal List
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCreateSharedOpen(true)}>
                <Users className="h-4 w-4 mr-2" />
                Shared List with a Friend
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {loadingLists ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {/* Pinned - My Restaurants is the flagship list and always shows
                first, ahead of any custom list. It isn't a custom_lists row
                (predates that table) - manage restaurant types from within
                that page, but it can be cleared out entirely from here. */}
            <Card
              className="cursor-pointer hover:shadow-md active:bg-muted/60 transition-all overflow-hidden border-primary/30"
              onClick={() => navigate('/my-list')}
            >
              <div className="h-1.5 bg-primary" />
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-11 h-11 rounded-lg flex items-center justify-center text-xl shrink-0 bg-primary/10 text-primary">
                  <UtensilsCrossed className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">My Restaurants</p>
                  <p className="text-xs text-muted-foreground">
                    {restaurantCount} place{restaurantCount === 1 ? '' : 's'}
                  </p>
                </div>
                {restaurantCount > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                    aria-label="Delete My Restaurants"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteRestaurantsOpen(true);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </CardContent>
            </Card>

            {lists.length === 0 ? (
              <Card className="sm:col-span-2 lg:col-span-3">
                <CardContent className="py-10 text-center">
                  <ListChecks className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
                  <h3 className="text-base font-medium mb-1">No custom lists yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Create a list for anything - movies to watch, beers to try, books to read.
                  </p>
                  <Button size="sm" onClick={() => { setEditList(null); setCreateOpen(true); }}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create New List
                  </Button>
                </CardContent>
              </Card>
            ) : (
            lists.map((list) => (
              <Card
                key={list.id}
                className="cursor-pointer hover:shadow-md active:bg-muted/60 transition-all overflow-hidden"
                onClick={() => navigate(`/my-lists/${list.id}`)}
              >
                <div className="h-1.5" style={{ backgroundColor: list.color }} />
                <CardContent className="p-4 flex items-center gap-3">
                  <div
                    className="w-11 h-11 rounded-lg flex items-center justify-center text-xl shrink-0"
                    style={{ backgroundColor: `${list.color}22` }}
                  >
                    {list.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{list.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {itemCounts[list.id] || 0} item{itemCounts[list.id] === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex items-center shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="List settings"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditList(list);
                        setCreateOpen(true);
                      }}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      aria-label="Delete list"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteListId(list.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
            )}
          </div>
        )}

        {sharedLists.length > 0 && (
          <div className="space-y-3 pt-2">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Users className="h-5 w-5" />
              Shared Lists
            </h2>
            <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {sharedLists.map((sl) => (
                <Card
                  key={sl.id}
                  className="cursor-pointer hover:shadow-md active:bg-muted/60 transition-all overflow-hidden"
                  onClick={() => navigate('/friends', { state: { tab: 'shared', listId: sl.id } })}
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <AnimalAvatar
                      emoji={sl.partner?.avatar_emoji}
                      color={sl.partner?.avatar_color}
                      className="w-11 h-11 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{sl.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        with {sl.partner?.display_name || sl.partner?.username || 'a friend'}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </main>

      <CreateListDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={invalidateLists}
        editList={editList}
      />

      <CreateSharedListDialog
        open={createSharedOpen}
        onOpenChange={setCreateSharedOpen}
        following={following}
        onSuccess={invalidateSharedLists}
      />

      <AlertDialog open={!!deleteListId} onOpenChange={(o) => !o && setDeleteListId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this list?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the list and everything in it. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteList}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteRestaurantsOpen} onOpenChange={(o) => !o && setDeleteRestaurantsOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete all of My Restaurants?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes all {restaurantCount} restaurant{restaurantCount === 1 ? '' : 's'} you've
              added - to-go, been-there, ratings, notes, and photos included. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingRestaurants}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteRestaurants();
              }}
              disabled={deletingRestaurants}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingRestaurants && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
