import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, MapPin, Search, List, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { isDuplicateRestaurant } from '@/lib/duplicateRestaurant';
import { usePlaceAutocomplete } from '@/hooks/usePlaceAutocomplete';
import { PlaceResultsDropdown } from '@/components/shared/PlaceResultsDropdown';

interface SharedListOption {
  id: string;
  name: string;
  partnerLabel: string;
}

interface AddMentionedPlaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeName: string;
}

type Destination = 'mine' | 'shared';

async function fetchSharedListOptions(userId: string): Promise<SharedListOption[]> {
  const { data, error } = await supabase
    .from('shared_lists')
    .select('id, name, user_a, user_b')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) return [];

  const partnerIds = rows.map((r) => (r.user_a === userId ? r.user_b : r.user_a));
  const { data: profs } = await supabase
    .from('profiles')
    .select('user_id, username, display_name')
    .in('user_id', partnerIds);
  const byId: Record<string, { username: string | null; display_name: string | null }> = {};
  (profs || []).forEach((p) => {
    byId[p.user_id] = p;
  });

  return rows.map((r) => {
    const partnerId = r.user_a === userId ? r.user_b : r.user_a;
    const partner = byId[partnerId];
    return {
      id: r.id,
      name: r.name,
      partnerLabel: partner?.display_name || partner?.username || 'a friend',
    };
  });
}

export function AddMentionedPlaceDialog({ open, onOpenChange, placeName }: AddMentionedPlaceDialogProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'to_go' | 'went_to'>('to_go');
  const [destination, setDestination] = useState<Destination>('mine');
  const [sharedListId, setSharedListId] = useState<string | null>(null);

  const [sharedLists, setSharedLists] = useState<SharedListOption[]>([]);
  const [sharedListsLoading, setSharedListsLoading] = useState(false);

  const {
    searchQuery,
    setSearchQuery,
    searchResults,
    searching,
    showResults,
    setShowResults,
    selectPlace,
    resetSearch,
  } = usePlaceAutocomplete({
    enabled: open,
    onSelect: (place) => {
      setName(place.name);
      setAddress(place.address);
      setLatitude(place.latitude);
      setLongitude(place.longitude);
      setPlaceId(place.placeId);
      setCategory(place.category);
    },
  });

  // Prime the search with the article's restaurant name whenever the
  // dialog opens for a new place - the hook's own debounced search effect
  // picks up this query change and runs automatically.
  useEffect(() => {
    if (!open) return;
    setName(placeName);
    setSearchQuery(placeName);
    setAddress('');
    setLatitude(null);
    setLongitude(null);
    setPlaceId(null);
    setCategory(null);
    setNotes('');
    setStatus('to_go');
    setDestination('mine');
    setSharedListId(null);
  }, [open, placeName]);

  useEffect(() => {
    if (!open || !user) return;
    setSharedListsLoading(true);
    fetchSharedListOptions(user.id)
      .then(setSharedLists)
      .catch((err) => console.error('Failed to load shared lists:', err))
      .finally(() => setSharedListsLoading(false));
  }, [open, user]);

  const handleSubmit = async () => {
    if (!user) return;
    if (!name.trim()) {
      toast.error('Add a place name');
      return;
    }
    if (destination === 'shared' && !sharedListId) {
      toast.error('Pick a shared list');
      return;
    }

    setLoading(true);
    try {
      if (destination === 'mine') {
        const duplicate = await isDuplicateRestaurant(user.id, {
          name,
          latitude,
          longitude,
          placeId,
        });
        if (duplicate) {
          toast.error("You've already added this place to your list.");
          setLoading(false);
          return;
        }

        // No type/folder is assigned here - the user can pick one afterward
        // from My List's edit dialog if they want this categorized.
        const { error } = await supabase.from('restaurants').insert({
          user_id: user.id,
          name: name.trim(),
          address: address.trim() || null,
          latitude,
          longitude,
          place_id: placeId,
          category,
          notes: notes.trim() || null,
          status,
          visited_at: status === 'went_to' ? new Date().toISOString() : null,
        });
        if (error) throw error;
        toast.success('Added to your list!');
      } else {
        const { error } = await supabase.from('shared_list_items').insert({
          list_id: sharedListId,
          added_by: user.id,
          name: name.trim(),
          address: address.trim() || null,
          latitude,
          longitude,
          status,
          notes: notes.trim() || null,
          visited_at: status === 'went_to' ? new Date().toISOString() : null,
        });
        if (error) throw error;
        toast.success('Added to shared list!');
      }
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to add place:', err);
      toast.error('Failed to add place');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add {placeName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Confirm the place</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search for this restaurant..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowResults(true);
                }}
                onFocus={() => searchResults.length > 0 && setShowResults(true)}
                className="pl-10"
              />
              {searching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            {showResults && searchResults.length > 0 && (
              <PlaceResultsDropdown
                results={searchResults}
                onSelect={selectPlace}
                onClose={() => setShowResults(false)}
                className="bg-popover border rounded-md shadow-lg max-h-[180px] overflow-y-auto overscroll-contain"
              />
            )}
            {address && !showResults && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {address}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Add to</Label>
            <Tabs value={destination} onValueChange={(v) => setDestination(v as Destination)}>
              <TabsList className="w-full">
                <TabsTrigger value="mine" className="flex-1">
                  <List className="h-4 w-4 mr-1.5" /> My List
                </TabsTrigger>
                <TabsTrigger value="shared" className="flex-1">
                  <Users className="h-4 w-4 mr-1.5" /> Shared List
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {destination === 'shared' && (
            <div className="space-y-2">
              <Label>Which shared list?</Label>
              {sharedListsLoading ? (
                <div className="flex justify-center py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : sharedLists.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  You don't have any shared lists yet. Create one from the Friends page first.
                </p>
              ) : (
                <Select value={sharedListId ?? undefined} onValueChange={setSharedListId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a shared list" />
                  </SelectTrigger>
                  <SelectContent>
                    {sharedLists.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name} · with {l.partnerLabel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as 'to_go' | 'went_to')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="to_go">To Go</SelectItem>
                <SelectItem value="went_to">Been There</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea
              placeholder="Add a note..."
              className="resize-none"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={loading || (destination === 'shared' && sharedLists.length === 0)}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {destination === 'mine' ? 'Add to My List' : 'Add to Shared List'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
