import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, UtensilsCrossed, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { isDuplicateRestaurant, isDuplicateCustomListItem } from '@/lib/duplicateRestaurant';
import type { ExplorePlace } from './ExplorePlaceCard';

const RESTAURANTS_DESTINATION = 'restaurants';

interface ListOption {
  id: string;
  name: string;
  icon: string;
}

interface AddExplorePlaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  place: ExplorePlace | null;
}

// One-tap "add this Explore place to one of my lists" - clicking a place
// elsewhere in Explore (card or map pin) only ever showed its details and
// comments; there was no way to actually save it without leaving Explore,
// searching for it again from scratch in Add Place, and re-entering
// details this component already has (name/address/coordinates/category).
export function AddExplorePlaceDialog({ open, onOpenChange, place }: AddExplorePlaceDialogProps) {
  const { user } = useAuth();
  const [lists, setLists] = useState<ListOption[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [destination, setDestination] = useState<string>(RESTAURANTS_DESTINATION);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setDestination(RESTAURANTS_DESTINATION);
    setLoadingLists(true);
    supabase
      .from('custom_lists')
      .select('id, name, icon')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setLists(data || []))
      .finally(() => setLoadingLists(false));
  }, [open, user]);

  const handleAdd = async () => {
    if (!user || !place) return;
    setSaving(true);
    try {
      if (destination === RESTAURANTS_DESTINATION) {
        const duplicate = await isDuplicateRestaurant(user.id, {
          name: place.name,
          latitude: place.latitude,
          longitude: place.longitude,
          placeId: place.place_id,
        });
        if (duplicate) {
          toast.error("You've already added this place to My Restaurants.");
          return;
        }
        const { error } = await supabase.from('restaurants').insert({
          user_id: user.id,
          name: place.name,
          address: place.address,
          latitude: place.latitude,
          longitude: place.longitude,
          place_id: place.place_id,
          category: place.category,
          status: 'to_go',
        });
        if (error) throw error;
        toast.success('Added to My Restaurants!');
      } else {
        const duplicate = await isDuplicateCustomListItem(destination, {
          name: place.name,
          latitude: place.latitude,
          longitude: place.longitude,
        });
        if (duplicate) {
          toast.error('This is already on that list.');
          return;
        }
        // Land new items on the list's first status (by sort_order) - every
        // list always has at least one, seeded at creation (see
        // CreateListDialog).
        const { data: firstStatus } = await supabase
          .from('custom_list_statuses')
          .select('id')
          .eq('list_id', destination)
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('name', { ascending: true })
          .limit(1)
          .maybeSingle();
        const { error } = await supabase.from('custom_list_items').insert({
          list_id: destination,
          user_id: user.id,
          name: place.name,
          address: place.address,
          latitude: place.latitude,
          longitude: place.longitude,
          status_id: firstStatus?.id ?? null,
        });
        if (error) throw error;
        const list = lists.find((l) => l.id === destination);
        toast.success(`Added to ${list?.name || 'your list'}!`);
      }
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to add explore place:', err);
      toast.error('Failed to add place');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Add to a list</DialogTitle>
          <DialogDescription>
            {place ? `Save "${place.name}" to one of your lists.` : 'Pick a list to save this place to.'}
          </DialogDescription>
        </DialogHeader>

        {loadingLists ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-1 max-h-[300px] overflow-y-auto overscroll-contain">
            <button
              type="button"
              onClick={() => setDestination(RESTAURANTS_DESTINATION)}
              className={`w-full flex items-center gap-3 p-2.5 rounded-md transition-colors text-left ${
                destination === RESTAURANTS_DESTINATION ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              <UtensilsCrossed className="h-5 w-5 shrink-0" />
              <span className="font-medium flex-1">My Restaurants</span>
              {destination === RESTAURANTS_DESTINATION && <Check className="h-4 w-4 shrink-0" />}
            </button>
            {lists.map((list) => (
              <button
                key={list.id}
                type="button"
                onClick={() => setDestination(list.id)}
                className={`w-full flex items-center gap-3 p-2.5 rounded-md transition-colors text-left ${
                  destination === list.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                }`}
              >
                <span className="text-lg leading-none shrink-0">{list.icon}</span>
                <span className="font-medium flex-1 truncate">{list.name}</span>
                {destination === list.id && <Check className="h-4 w-4 shrink-0" />}
              </button>
            ))}
          </div>
        )}

        <Button className="w-full" onClick={handleAdd} disabled={saving || !place}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Add Place
        </Button>
      </DialogContent>
    </Dialog>
  );
}
