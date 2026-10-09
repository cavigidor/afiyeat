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
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MapPin, DollarSign, Star, StickyNote, ImageIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { blockedByContentFilter } from '@/lib/contentFilter';
import { Spinner } from '@/components/ui/spinner';

export type PriceMode = 'manual' | 'dollar';
export type RatingMode = 'scale_10' | 'stars_5' | 'manual';

export interface CustomList {
  id: string;
  name: string;
  icon: string;
  color: string;
  show_location: boolean;
  show_price: boolean;
  price_mode: PriceMode;
  show_rating: boolean;
  rating_mode: RatingMode;
  show_notes: boolean;
  show_photos: boolean;
  // Kept only so old rows still typecheck - statuses are now managed
  // per-list via custom_list_statuses (see ListStatusesManager), not these
  // two fixed labels. New lists no longer set them to anything meaningful.
  status_todo_label: string;
  status_done_label: string;
}

interface CreateListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  // When set, the dialog edits this list's config instead of creating a new
  // one - same fields, so list settings can be changed any time after
  // creation rather than being locked in at creation.
  editList?: CustomList | null;
}

interface ListPreset {
  label: string;
  icon: string;
  /** Short phrase for the confirmation line, e.g. "books". */
  noun: string;
  showLocation: boolean;
  showPrice: boolean;
  priceMode: PriceMode;
  showRating: boolean;
  ratingMode: RatingMode;
  showNotes: boolean;
  showPhotos: boolean;
  /** Seeded instead of the generic To Do / Done. */
  statuses: string[];
}

// One-tap starting points. Each fills in the name AND the whole setup below
// it - which fields apply, how price and rating are recorded, and statuses
// in that thing's own words ("Want to Read / Reading / Read" rather than
// "To Do / Done"). The point is that choosing "Books" should produce a
// usable books list in one tap; everything stays editable before saving
// and afterwards from the list's settings.
//
// Media is rated in stars, the way people rate films and books; food and
// drink use 1-10 to match how restaurants are rated elsewhere in the app.
const LIST_PRESETS: ListPreset[] = [
  {
    label: 'Movies', icon: '🎬', noun: 'movies',
    showLocation: false, showPrice: false, priceMode: 'dollar',
    showRating: true, ratingMode: 'stars_5', showNotes: true, showPhotos: false,
    statuses: ['Want to Watch', 'Watched'],
  },
  {
    label: 'Shows', icon: '📺', noun: 'shows',
    showLocation: false, showPrice: false, priceMode: 'dollar',
    showRating: true, ratingMode: 'stars_5', showNotes: true, showPhotos: false,
    statuses: ['Want to Watch', 'Watching', 'Finished'],
  },
  {
    label: 'Books', icon: '📚', noun: 'books',
    showLocation: false, showPrice: false, priceMode: 'dollar',
    showRating: true, ratingMode: 'stars_5', showNotes: true, showPhotos: true,
    statuses: ['Want to Read', 'Reading', 'Read'],
  },
  {
    // Venue matters and so does the ticket price, which is a specific
    // amount rather than a $-$$$$ band.
    label: 'Concerts', icon: '🎵', noun: 'concerts',
    showLocation: true, showPrice: true, priceMode: 'manual',
    showRating: true, ratingMode: 'stars_5', showNotes: true, showPhotos: true,
    statuses: ['Want to Go', 'Been'],
  },
  {
    // Bottles are bought, not visited: no address, an actual price.
    label: 'Wines', icon: '🍷', noun: 'wines',
    showLocation: false, showPrice: true, priceMode: 'manual',
    showRating: true, ratingMode: 'scale_10', showNotes: true, showPhotos: true,
    statuses: ['Want to Try', 'Tried'],
  },
  {
    label: 'Beers', icon: '🍺', noun: 'beers',
    showLocation: false, showPrice: false, priceMode: 'dollar',
    showRating: true, ratingMode: 'scale_10', showNotes: true, showPhotos: true,
    statuses: ['Want to Try', 'Tried'],
  },
  {
    // A place you go to, so it's set up like restaurants.
    label: 'Coffee Shops', icon: '☕', noun: 'coffee shops',
    showLocation: true, showPrice: true, priceMode: 'dollar',
    showRating: true, ratingMode: 'scale_10', showNotes: true, showPhotos: true,
    statuses: ['Want to Go', 'Been There'],
  },
];

const DEFAULT_STATUSES = ['To Do', 'Done'];

export function CreateListDialog({ open, onOpenChange, onSuccess, editList }: CreateListDialogProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [showLocation, setShowLocation] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [priceMode, setPriceMode] = useState<PriceMode>('dollar');
  const [showRating, setShowRating] = useState(false);
  const [ratingMode, setRatingMode] = useState<RatingMode>('scale_10');
  const [showNotes, setShowNotes] = useState(true);
  const [showPhotos, setShowPhotos] = useState(true);
  // The preset last tapped, if any. Kept even if the name is then edited:
  // renaming "Books" to "Books 2026" shouldn't lose the books statuses.
  const [preset, setPreset] = useState<ListPreset | null>(null);

  const isEditing = !!editList;

  const applyPreset = (p: ListPreset) => {
    setPreset(p);
    setName(p.label);
    setShowLocation(p.showLocation);
    setShowPrice(p.showPrice);
    setPriceMode(p.priceMode);
    setShowRating(p.showRating);
    setRatingMode(p.ratingMode);
    setShowNotes(p.showNotes);
    setShowPhotos(p.showPhotos);
  };

  useEffect(() => {
    if (!open) return;
    setPreset(null);
    if (editList) {
      setName(editList.name);
      setShowLocation(editList.show_location);
      setShowPrice(editList.show_price);
      setPriceMode(editList.price_mode);
      setShowRating(editList.show_rating);
      setRatingMode(editList.rating_mode);
      setShowNotes(editList.show_notes);
      setShowPhotos(editList.show_photos);
    } else {
      setName('');
      setShowLocation(true);
      setShowPrice(true);
      setPriceMode('dollar');
      setShowRating(false);
      setRatingMode('scale_10');
      setShowNotes(true);
      setShowPhotos(true);
    }
  }, [open, editList]);

  const handleSubmit = async () => {
    if (!user) return;
    if (!name.trim()) {
      toast.error('Give your list a name');
      return;
    }
    if (blockedByContentFilter(name)) return;
    setLoading(true);

    const payload = {
      name: name.trim(),
      show_location: showLocation,
      show_price: showPrice,
      price_mode: priceMode,
      show_rating: showRating,
      rating_mode: ratingMode,
      show_notes: showNotes,
      show_photos: showPhotos,
    };

    if (isEditing) {
      const { error } = await supabase.from('custom_lists').update(payload).eq('id', editList!.id);
      setLoading(false);
      if (error) {
        toast.error('Failed to update list');
        console.error(error);
        return;
      }
      toast.success('List updated!');
      onOpenChange(false);
      onSuccess();
      return;
    }

    const { data: newList, error } = await supabase
      .from('custom_lists')
      // A preset list gets its own icon on the My Lists card and list
      // header; otherwise the column default applies.
      .insert({ ...payload, user_id: user.id, ...(preset ? { icon: preset.icon } : {}) })
      .select()
      .single();

    if (error || !newList) {
      setLoading(false);
      toast.error('Failed to create list');
      console.error(error);
      return;
    }

    // Every list needs at least one status. A preset seeds statuses in its
    // own words; otherwise the generic pair. Either way they're renameable,
    // removable and expandable afterward from the list's own page (Modify >
    // Statuses), so nothing has to be decided up front.
    const statusNames = preset?.statuses ?? DEFAULT_STATUSES;
    const statusRows = statusNames.map((statusName, i) => ({
      list_id: newList.id,
      user_id: user.id,
      name: statusName,
      sort_order: i,
    }));
    let { error: statusError } = await supabase.from('custom_list_statuses').insert(statusRows);
    if (statusError) {
      // One retry covers a dropped connection; anything still failing after
      // that is a real problem.
      ({ error: statusError } = await supabase.from('custom_list_statuses').insert(statusRows));
    }
    if (statusError) {
      // A list with no statuses can't hold items properly, so don't leave a
      // half-made one behind and call it a success. Removing the list also
      // removes anything partially inserted with it.
      console.error('Failed to seed default statuses:', statusError);
      await supabase.from('custom_lists').delete().eq('id', newList.id);
      setLoading(false);
      toast.error("Couldn't finish creating the list. Please try again.");
      return;
    }

    setLoading(false);
    toast.success('List created!');
    onOpenChange(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'List Settings' : 'Create New List'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>List name</Label>
            <Input
              placeholder="e.g. Movies, Beers, Books to Read..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            {!isEditing && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-xs text-muted-foreground mr-0.5">Quick start:</span>
                {LIST_PRESETS.map((p) => {
                  const selected = preset?.label === p.label;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => applyPreset(p)}
                      aria-pressed={selected}
                      className={`active-press text-xs px-2.5 py-1.5 rounded-full border transition-colors duration-150 ${
                        selected
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-muted/60 border-transparent active:bg-muted'
                      }`}
                    >
                      {p.icon} {p.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-sm font-medium">What to include when adding items</p>
            {preset && !isEditing ? (
              // Says what just happened. The toggles sit below the chips and
              // are often off-screen on a phone, so without this a tap looks
              // like it only changed the name.
              <p className="text-xs text-primary -mt-2">
                Set up for {preset.noun}, with “{preset.statuses.join(' / ')}” statuses. Change
                anything below.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground -mt-2">
                Turn off what doesn't apply - a beer list probably doesn't need an address, a book
                list probably doesn't need a price.
              </p>
            )}

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm">Address &amp; map</p>
                </div>
              </div>
              <Switch checked={showLocation} onCheckedChange={setShowLocation} />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <DollarSign className="h-4 w-4 text-muted-foreground shrink-0" />
                  <p className="text-sm">Price</p>
                </div>
                <Switch checked={showPrice} onCheckedChange={setShowPrice} />
              </div>
              {showPrice && (
                <Select value={priceMode} onValueChange={(v) => setPriceMode(v as PriceMode)}>
                  <SelectTrigger className="ml-6 w-[calc(100%-1.5rem)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dollar">Dollar signs ($ - $$$$)</SelectItem>
                    <SelectItem value="manual">Manual entry</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Star className="h-4 w-4 text-muted-foreground shrink-0" />
                  <p className="text-sm">Rating</p>
                </div>
                <Switch checked={showRating} onCheckedChange={setShowRating} />
              </div>
              {showRating && (
                <Select value={ratingMode} onValueChange={(v) => setRatingMode(v as RatingMode)}>
                  <SelectTrigger className="ml-6 w-[calc(100%-1.5rem)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="scale_10">Scale of 1-10</SelectItem>
                    <SelectItem value="stars_5">5 stars</SelectItem>
                    <SelectItem value="manual">Manual entry</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <StickyNote className="h-4 w-4 text-muted-foreground shrink-0" />
                <p className="text-sm">Notes</p>
              </div>
              <Switch checked={showNotes} onCheckedChange={setShowNotes} />
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                <p className="text-sm">Photos</p>
              </div>
              <Switch checked={showPhotos} onCheckedChange={setShowPhotos} />
            </div>
          </div>

          {isEditing && (
            <p className="text-xs text-muted-foreground">
              Manage this list's types (color-coded categories with map pin emoji) and statuses
              (the stages items move through) from the list page itself - tap Modify.
            </p>
          )}

          <Button className="w-full" onClick={handleSubmit} disabled={loading}>
            {loading && <Spinner className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? 'Save Changes' : 'Create List'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
