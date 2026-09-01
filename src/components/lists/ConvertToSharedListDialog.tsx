import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AnimalAvatar } from '@/components/shared/AnimalAvatar';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { FollowingProfile } from '@/hooks/useFollowing';
import type { CustomList } from './CreateListDialog';
import type { CustomListItem } from './AddCustomListItemDialog';
import type { ManagedListStatus } from '@/hooks/useListStatusManagement';
import { getPriceSortValue, getRatingSortValue } from '@/lib/customListValues';

interface ConvertToSharedListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: CustomList;
  items: CustomListItem[];
  // Used only to map each item onto shared_list_items' fixed to_go/went_to
  // status - the last status by sort_order is treated as the "done"
  // equivalent, since shared lists weren't part of the custom-statuses
  // redesign and still use a fixed two-status model.
  statuses: ManagedListStatus[];
  following: FollowingProfile[];
  onSuccess: (newListId: string) => void;
}

// Creates a brand new shared_lists row (+ shared_list_items) from an
// existing personal custom list, rather than converting the list in
// place - the original is left completely untouched. Two reasons:
//   1. shared_list_items has no photo support at all, and custom lists can
//      have photos per item - converting in place would silently delete
//      them. Leaving the original intact means nothing is ever lost.
//   2. It's a plain client-side insert (owner already satisfies every RLS
//      check on both tables), so no edge function or migration is needed.
export function ConvertToSharedListDialog({
  open,
  onOpenChange,
  list,
  items,
  statuses,
  following,
  onSuccess,
}: ConvertToSharedListDialogProps) {
  const { user } = useAuth();
  const [name, setName] = useState(list.name);
  const lastStatusId = [...statuses].sort((a, b) => {
    const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    return ao - bo;
  }).at(-1)?.id;
  const [friendId, setFriendId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setName(list.name);
    setFriendId(null);
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (!name.trim()) {
      toast.error('Give the shared list a name');
      return;
    }
    if (!friendId) {
      toast.error('Pick a friend to share with');
      return;
    }

    setLoading(true);
    try {
      const { data: sharedList, error: listError } = await supabase
        .from('shared_lists')
        .insert({ name: name.trim(), user_a: user.id, user_b: friendId })
        .select()
        .single();
      if (listError) throw listError;

      if (items.length > 0) {
        const rows = items.map((item) => ({
          list_id: sharedList.id,
          added_by: user.id,
          name: item.name,
          address: item.address,
          latitude: item.latitude,
          longitude: item.longitude,
          status: lastStatusId && item.status_id === lastStatusId ? 'went_to' : 'to_go',
          // Only the structured price/rating columns carry over - manual-
          // entry values (price_manual/rating_manual) aren't guaranteed to
          // fall inside shared_list_items' 1-4 / 0-10 check constraints,
          // so those are left blank rather than risking an insert failure.
          rating: list.rating_mode === 'manual' ? null : getRatingSortValue(item, list),
          price_level: list.price_mode === 'manual' ? null : getPriceSortValue(item, list),
          notes: item.notes,
        }));

        const { error: itemsError } = await supabase.from('shared_list_items').insert(rows);
        if (itemsError) throw itemsError;
      }

      const skippedPhotos = items.some((i) => (i.images?.length ?? 0) > 0);
      toast.success(
        skippedPhotos
          ? 'Shared list created! Your original list is unchanged (photos weren\'t carried over - Shared Lists don\'t support them yet).'
          : 'Shared list created! Your original list is unchanged.',
      );
      reset();
      onOpenChange(false);
      onSuccess(sharedList.id);
    } catch (error: any) {
      toast.error(error.message || 'Failed to create shared list');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Make a Shared List</DialogTitle>
          <DialogDescription>
            Creates a new shared list with a friend, seeded from "{list.name}". You'll both be able
            to add, remove, rate, and comment on places - your original list stays as-is.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>List name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Share with</Label>
            {following.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                Follow someone first to share a list with them.
              </p>
            ) : (
              <div className="max-h-[260px] overflow-y-auto space-y-1 rounded-md border p-1">
                {following.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => setFriendId(profile.user_id)}
                    className={`w-full flex items-center gap-3 p-2 rounded-md transition-colors text-left ${
                      friendId === profile.user_id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                    }`}
                  >
                    <AnimalAvatar emoji={profile.avatar_emoji} color={profile.avatar_color} className="h-8 w-8" />
                    <span className="font-medium truncate">
                      {profile.display_name || profile.username}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Button className="w-full" onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Shared List
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
