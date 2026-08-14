import { useState, useEffect, useMemo } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, MapPin, Search, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { PriceLevelPicker } from '@/components/restaurants/PriceLevelPicker';
import { PRICE_LABELS } from './EmojiSlider';

interface PlaceResult {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  mapboxId?: string;
}

interface MyPlace {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  price_level: number | null;
}

interface MyListOption {
  id: string;
  name: string;
  icon: string;
}

// The "pick from mine" source: either the My Restaurants table, or one of
// the user's My Lists (custom_lists) - both are queried into the same
// MyPlace shape below, so the rest of the picker UI doesn't need to care
// which one it's showing.
const RESTAURANTS_SOURCE = 'restaurants';

interface AddSharedItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listId: string;
  onSuccess: () => void;
}

export function AddSharedItemDialog({ open, onOpenChange, listId, onSuccess }: AddSharedItemDialogProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [status, setStatus] = useState<'to_go' | 'went_to'>('to_go');
  const [priceLevel, setPriceLevel] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [sessionToken] = useState(() => crypto.randomUUID());

  const [myLists, setMyLists] = useState<MyListOption[]>([]);
  const [sourceListId, setSourceListId] = useState<string>(RESTAURANTS_SOURCE);
  const [myPlaces, setMyPlaces] = useState<MyPlace[]>([]);
  const [loadingMine, setLoadingMine] = useState(false);
  const [mineSearch, setMineSearch] = useState('');

  const priceEmojiIndex = useMemo(() => Math.floor(Math.random() * 10), [open]);

  const reset = () => {
    setName('');
    setAddress('');
    setLatitude(null);
    setLongitude(null);
    setStatus('to_go');
    setPriceLevel(null);
    setNotes('');
    setSearchQuery('');
    setSearchResults([]);
    setShowResults(false);
    setMineSearch('');
    setSourceListId(RESTAURANTS_SOURCE);
  };

  useEffect(() => {
    if (open && !userLocation) {
      navigator.geolocation.getCurrentPosition(
        (position) =>
          setUserLocation({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => {}
      );
    }
  }, [open, userLocation]);

  // The list of pickable sources - My Restaurants plus every My Lists list -
  // only needs loading once per dialog open, independent of which one is
  // currently selected.
  useEffect(() => {
    const loadLists = async () => {
      if (!open || !user) return;
      const { data } = await supabase
        .from('custom_lists')
        .select('id, name, icon')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      setMyLists(data || []);
    };
    loadLists();
  }, [open, user]);

  useEffect(() => {
    const loadMine = async () => {
      if (!open || !user) return;
      setLoadingMine(true);
      if (sourceListId === RESTAURANTS_SOURCE) {
        const { data } = await supabase
          .from('restaurants')
          .select('id, name, address, latitude, longitude, price_level')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        setMyPlaces(data || []);
      } else {
        const { data } = await supabase
          .from('custom_list_items')
          .select('id, name, address, latitude, longitude, price_level')
          .eq('list_id', sourceListId)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        setMyPlaces(data || []);
      }
      setLoadingMine(false);
    };
    loadMine();
  }, [open, user, sourceListId]);

  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timeoutId = setTimeout(async () => {
      setSearching(true);
      try {
        const { data, error } = await supabase.functions.invoke('place-search', {
          body: {
            query: searchQuery,
            latitude: userLocation?.lat,
            longitude: userLocation?.lng,
            sessionToken,
          },
        });
        if (error) throw error;
        setSearchResults(data.results || []);
        setShowResults(true);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, userLocation]);

  const selectPlace = async (place: PlaceResult) => {
    setSearchQuery(place.name);
    setShowResults(false);
    setSearchResults([]);

    if (place.mapboxId && (place.latitude === null || place.longitude === null)) {
      try {
        const { data, error } = await supabase.functions.invoke('place-retrieve', {
          body: { mapboxId: place.mapboxId, sessionToken },
        });
        if (error) throw error;
        const result = data.result;
        setName(result.name);
        setAddress(result.address || '');
        setLatitude(result.latitude ?? null);
        setLongitude(result.longitude ?? null);
        return;
      } catch (err) {
        console.error('Retrieve error:', err);
      }
    }
    setName(place.name);
    setAddress(place.address || '');
    setLatitude(place.latitude);
    setLongitude(place.longitude);
  };

  const pickMyPlace = (p: MyPlace) => {
    setName(p.name);
    setAddress(p.address || '');
    setLatitude(p.latitude);
    setLongitude(p.longitude);
    setPriceLevel(p.price_level);
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (!name.trim()) {
      toast.error('Add a place name');
      return;
    }
    setLoading(true);
    const { error } = await supabase.from('shared_list_items').insert({
      list_id: listId,
      added_by: user.id,
      name: name.trim(),
      address: address.trim() || null,
      latitude,
      longitude,
      status,
      price_level: priceLevel,
      notes: notes.trim() || null,
      visited_at: status === 'went_to' ? new Date().toISOString() : null,
    });
    setLoading(false);

    if (error) {
      toast.error('Failed to add place');
      console.error(error);
    } else {
      toast.success('Place added to shared list!');
      reset();
      onOpenChange(false);
      onSuccess();
    }
  };

  const filteredMine = myPlaces.filter((p) => {
    if (!mineSearch.trim()) return true;
    const q = mineSearch.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.address?.toLowerCase().includes(q);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Place to Shared List</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="search" className="space-y-4">
          <TabsList className="w-full">
            {/* min-w-0 lets these shrink below their content width (flex
                items default to min-width:auto, which was forcing "From My
                List" wider than the tab bar on narrow phones and pushing
                the dialog into horizontal overflow); truncate on the label
                keeps that clipping graceful instead of just cutting text off. */}
            <TabsTrigger value="search" className="flex-1 min-w-0 gap-1.5 px-2 sm:px-3">
              <Search className="h-4 w-4 shrink-0" />
              <span className="truncate">Search</span>
            </TabsTrigger>
            <TabsTrigger value="mine" className="flex-1 min-w-0 gap-1.5 px-2 sm:px-3">
              <Plus className="h-4 w-4 shrink-0" />
              <span className="truncate">My Lists</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="search" className="space-y-2">
            <Label>Search restaurant</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search for a restaurant..."
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
              <div className="bg-popover border rounded-md shadow-lg max-h-[180px] overflow-y-auto">
                {searchResults.map((place) => (
                  <button
                    key={place.id}
                    type="button"
                    className="w-full text-left px-4 py-3 hover:bg-accent transition-colors border-b last:border-b-0"
                    onClick={() => selectPlace(place)}
                  >
                    <div className="font-medium">{place.name}</div>
                    <div className="text-sm text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {place.address}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="mine" className="space-y-2">
            <Label>Pick from</Label>
            <Select value={sourceListId} onValueChange={setSourceListId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={RESTAURANTS_SOURCE}>🍽️ My Restaurants</SelectItem>
                {myLists.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.icon} {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search this list..."
                value={mineSearch}
                onChange={(e) => setMineSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="max-h-[200px] overflow-y-auto rounded-md border">
              {loadingMine ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredMine.length === 0 ? (
                <p className="text-sm text-muted-foreground p-3">
                  {mineSearch.trim() ? 'No matching items.' : 'Nothing in this list yet.'}
                </p>
              ) : (
                filteredMine.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="w-full text-left px-4 py-2.5 hover:bg-accent transition-colors border-b last:border-b-0"
                    onClick={() => pickMyPlace(p)}
                  >
                    <div className="font-medium">{p.name}</div>
                    {p.address && (
                      <div className="text-sm text-muted-foreground flex items-center gap-1 truncate">
                        <MapPin className="h-3 w-3 flex-shrink-0" />
                        {p.address}
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>

        <div className="space-y-4 pt-2 border-t">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input placeholder="Place name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Address</Label>
            <Input placeholder="123 Main St, City" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>

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

          <div className="space-y-1">
            <Label>
              Price Level: {priceLevel ? `${'$'.repeat(priceLevel)} (${PRICE_LABELS[priceLevel - 1]})` : 'Not set'}
            </Label>
            <PriceLevelPicker
              value={priceLevel}
              onChange={setPriceLevel}
              labels={PRICE_LABELS}
            />
          </div>

          <div className="space-y-2">
            <Label>Comment</Label>
            <Textarea
              placeholder="Add a shared note about this place..."
              className="resize-none"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <Button className="w-full" onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add Place
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
