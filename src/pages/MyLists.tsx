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
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Plus, ListChecks, Settings, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { CreateListDialog, type CustomList } from '@/components/lists/CreateListDialog';

async function fetchMyLists(userId: string): Promise<CustomList[]> {
  const { data, error } = await supabase
    .from('custom_lists')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as CustomList[];
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

export default function MyLists() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editList, setEditList] = useState<CustomList | null>(null);
  const [deleteListId, setDeleteListId] = useState<string | null>(null);

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

  const invalidateLists = () => {
    queryClient.invalidateQueries({ queryKey: ['custom_lists', user?.id] });
    queryClient.invalidateQueries({ queryKey: ['custom_list_item_counts', user?.id] });
  };

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
              Your own custom lists - movies, beers, books, anything you want to track.
            </p>
          </div>
          <Button onClick={() => { setEditList(null); setCreateOpen(true); }} size="sm" className="sm:size-default shrink-0">
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Create New List</span>
          </Button>
        </div>

        {loadingLists ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : lists.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <ListChecks className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">You have no lists</h3>
              <p className="text-muted-foreground mb-6">
                Create a list for anything - movies to watch, beers to try, books to read.
              </p>
              <Button onClick={() => { setEditList(null); setCreateOpen(true); }}>
                <Plus className="h-4 w-4 mr-2" />
                Create New List
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {lists.map((list) => (
              <Card
                key={list.id}
                className="cursor-pointer hover:shadow-md transition-shadow overflow-hidden"
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
            ))}
          </div>
        )}
      </main>

      <CreateListDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={invalidateLists}
        editList={editList}
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
    </div>
  );
}
