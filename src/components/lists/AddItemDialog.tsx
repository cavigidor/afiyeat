import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search, ChevronDown, ImagePlus, Camera, X, AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PriceLevelPicker } from '@/components/restaurants/PriceLevelPicker';
import { StarRatingPicker } from '@/components/lists/StarRatingPicker';
import { TagMultiSelect } from '@/components/shared/TagMultiSelect';
import { PlaceResultsDropdown } from '@/components/shared/PlaceResultsDropdown';
import { useAuth } from '@/contexts/AuthContext';
import { usePlaceAutocomplete } from '@/hooks/usePlaceAutocomplete';
import { blockedByContentFilter } from '@/lib/contentFilter';
import { validateImageFile, compressImage, MAX_IMAGES_PER_ITEM } from '@/lib/imageValidation';
import { isNative, capturePhoto } from '@/lib/native';
import { hapticSuccess } from '@/lib/haptics';
import { errorMessage } from '@/lib/utils';
import type { PickedPlace } from '@/lib/appleMaps';
import {
  RESTAURANTS_DESTINATION,
  destinationHasLocation,
  destinationPath,
  fetchAddDestinations,
  fetchFolders,
  fetchListStatuses,
  fetchListTypes,
  readLastDestination,
  rememberDestination,
  type AddDestination,
} from '@/lib/addDestinations';
import { saveCustomListItem, saveRestaurant, saveSharedListItem, type SaveResult } from '@/lib/listItemSave';

const PRICE_LABELS = ['<$30', '<$50', '<$100', '$100+'];

type RatingScale = 'ten' | 'five' | 'manual' | null;

interface AddItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Destination key to start on when there's no remembered one, or to
   * prefer when the caller knows better (e.g. opened from Lists -> Shared).
   */
  preferredDestination?: 'restaurants' | 'shared' | null;
}

const sortByOrder = <T extends { name: string; sort_order?: number | null }>(rows: T[]) =>
  [...rows].sort((a, b) => {
    const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    return ao !== bo ? ao - bo : a.name.localeCompare(b.name);
  });

/**
 * Add Item, from the Lists screen: one form for adding something to any
 * list you can add to - My Restaurants, your own lists, or a shared list -
 * without opening that list first.
 *
 * The form shows only what the chosen list uses (its statuses, types,
 * price, rating, location, notes and photos, per its settings), and
 * switching lists keeps everything that still applies. Saving goes through
 * the same code as each list's own Add button (lib/listItemSave.ts), so
 * duplicate checks and stored fields are identical either way.
 */
export function AddItemDialog({ open, onOpenChange, preferredDestination = null }: AddItemDialogProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // -- Destinations -------------------------------------------------------
  const { data: destinations, isLoading: loadingDestinations, isError: destinationsFailed } = useQuery({
    queryKey: ['add-item-destinations', user?.id],
    queryFn: () => fetchAddDestinations(user!.id),
    enabled: !!user && open,
    staleTime: 30 * 1000,
  });

  const allDestinations = useMemo<AddDestination[]>(
    () => [RESTAURANTS_DESTINATION, ...(destinations?.custom ?? []), ...(destinations?.shared ?? [])],
    [destinations],
  );
  const [destKey, setDestKey] = useState<string>('restaurants');
  const dest = allDestinations.find((d) => d.key === destKey) ?? RESTAURANTS_DESTINATION;

  // Pick the starting destination each time the dialog opens: the one
  // asked for, else the last one used (if it still exists), else My
  // Restaurants.
  const chosenForOpen = useRef(false);
  useEffect(() => {
    if (!open) {
      chosenForOpen.current = false;
      return;
    }
    if (chosenForOpen.current || !destinations) return;
    chosenForOpen.current = true;
    const last = readLastDestination();
    const exists = (key: string | null) => !!key && allDestinations.some((d) => d.key === key);
    if (preferredDestination === 'shared' && destinations.shared.length > 0) {
      setDestKey(last?.startsWith('shared:') && exists(last) ? last : destinations.shared[0].key);
    } else if (preferredDestination === 'restaurants') {
      setDestKey('restaurants');
    } else {
      setDestKey(exists(last) ? last! : 'restaurants');
    }
  }, [open, destinations, allDestinations, preferredDestination]);

  const customListId = dest.kind === 'custom' ? dest.list.id : null;
  const { data: statuses = [] } = useQuery({
    queryKey: ['add-item-statuses', customListId],
    queryFn: () => fetchListStatuses(customListId!),
    enabled: open && !!customListId,
  });
  const { data: types = [] } = useQuery({
    queryKey: ['add-item-types', customListId],
    queryFn: () => fetchListTypes(customListId!),
    enabled: open && !!customListId,
  });
  const { data: folders = [] } = useQuery({
    queryKey: ['add-item-folders', user?.id],
    queryFn: () => fetchFolders(user!.id),
    enabled: open && !!user && dest.kind === 'restaurants',
  });
  const sortedStatuses = useMemo(() => sortByOrder(statuses), [statuses]);

  // -- What the destination uses -------------------------------------------
  const hasLocation = destinationHasLocation(dest);
  const list = dest.kind === 'custom' ? dest.list : null;
  const priceMode: 'dollar' | 'manual' | null =
    dest.kind === 'custom' ? (list!.show_price ? list!.price_mode : null) : 'dollar';
  const ratingScale: RatingScale =
    dest.kind === 'restaurants'
      ? 'ten'
      : dest.kind === 'custom' && list!.show_rating
        ? list!.rating_mode === 'scale_10'
          ? 'ten'
          : list!.rating_mode === 'stars_5'
            ? 'five'
            : 'manual'
        : null;
  const hasNotes = dest.kind !== 'custom' || list!.show_notes;
  const hasPhotos = dest.kind === 'restaurants' || (dest.kind === 'custom' && list!.show_photos);

  // -- Form state -----------------------------------------------------------
  // The item itself: kept when the destination changes.
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [picked, setPicked] = useState<(PickedPlace & { category: string | null }) | null>(null);
  const [notes, setNotes] = useState('');
  const [priceLevel, setPriceLevel] = useState<number | null>(null);
  const [priceManual, setPriceManual] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [ratingManual, setRatingManual] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  // Belongs to one list: reset when the destination changes.
  const [placeStatus, setPlaceStatus] = useState<'to_go' | 'went_to'>('to_go');
  const [customStatusId, setCustomStatusId] = useState<string | null>(null);
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [folderIds, setFolderIds] = useState<string[]>([]);

  const [moreOpen, setMoreOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Why the last save didn't go through, shown above the Add button (a
  // toast would sit on top of the button on a phone).
  const [problem, setProblem] = useState<string | null>(null);

  const {
    searchQuery,
    setSearchQuery,
    searchResults,
    searching,
    setShowResults,
    noResults,
    dropdownVisible,
    selectPlace,
    resetSearch,
  } = usePlaceAutocomplete({
    enabled: open && hasLocation,
    // Restaurants and shared lists are places to eat and drink; a custom
    // list can be anything with an address (a museum, a park).
    kind: dest.kind === 'custom' ? 'any' : 'food',
    onSelect: (place) => {
      setName(place.name);
      setAddress(place.address);
      setLatitude(place.latitude);
      setLongitude(place.longitude);
      setPicked({ applePlaceId: place.applePlaceId, appleAddress: place.address, category: place.category });
      setProblem(null);
    },
  });

  // Fresh form each time the dialog opens. Any "Added to …" toast from
  // the previous add is cleared too: on a phone it sits over the Add button.
  useEffect(() => {
    if (!open) return;
    toast.dismiss();
    setName('');
    setAddress('');
    setLatitude(null);
    setLongitude(null);
    setPicked(null);
    setNotes('');
    setPriceLevel(null);
    setPriceManual('');
    setRating(null);
    setRatingManual('');
    setPhotos([]);
    setPhotoPreviews([]);
    setPlaceStatus('to_go');
    setTypeIds([]);
    setFolderIds([]);
    setMoreOpen(false);
    setProblem(null);
    resetSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Switching lists: drop what belonged to the old list (its statuses and
  // types), keep what still applies. To Go / Been There carries over
  // between My Restaurants and shared lists, which both use it. A rating
  // is kept only if the new list rates on the same scale.
  const previousScale = useRef<RatingScale>(ratingScale);
  useEffect(() => {
    setTypeIds([]);
    setFolderIds([]);
    setCustomStatusId(null);
    setProblem(null);
    if (previousScale.current !== ratingScale) {
      setRating(null);
      setRatingManual('');
    }
    previousScale.current = ratingScale;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destKey]);

  // A custom list's first status (by its order) is the default, as in the
  // list's own Add dialog.
  useEffect(() => {
    if (dest.kind === 'custom' && !customStatusId && sortedStatuses.length > 0) {
      setCustomStatusId(sortedStatuses[0].id);
    }
  }, [dest.kind, customStatusId, sortedStatuses]);

  // -- Photos -----------------------------------------------------------------
  const addFiles = async (incoming: File[]) => {
    const remaining = MAX_IMAGES_PER_ITEM - photos.length;
    if (remaining <= 0) {
      toast.error(`You can add up to ${MAX_IMAGES_PER_ITEM} photos.`);
      return;
    }
    const valid = incoming.filter((file) => {
      const issue = validateImageFile(file);
      if (issue) toast.error(`${file.name}: ${issue}`);
      return !issue;
    });
    const compressed = await Promise.all(valid.slice(0, remaining).map((f) => compressImage(f)));
    setPhotos((prev) => [...prev, ...compressed]);
    compressed.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => setPhotoPreviews((prev) => [...prev, e.target?.result as string]);
      reader.readAsDataURL(file);
    });
  };
  const removePhoto = (i: number) => {
    setPhotos((prev) => prev.filter((_, idx) => idx !== i));
    setPhotoPreviews((prev) => prev.filter((_, idx) => idx !== i));
  };

  // -- Save -------------------------------------------------------------------
  const invalidateDestination = (d: AddDestination) => {
    const uid = user?.id;
    if (d.kind === 'restaurants') {
      void queryClient.invalidateQueries({ queryKey: ['restaurants', uid] });
      void queryClient.invalidateQueries({ queryKey: ['restaurant_count', uid] });
      void queryClient.invalidateQueries({ queryKey: ['home-own-saved', uid] });
    } else if (d.kind === 'custom') {
      void queryClient.invalidateQueries({ queryKey: ['custom_list_items', d.list.id] });
      void queryClient.invalidateQueries({ queryKey: ['custom_list_item_counts', uid] });
    } else {
      void queryClient.invalidateQueries({ queryKey: ['shared_lists_preview', uid] });
    }
  };

  const handleSave = async () => {
    if (!user || saving) return;
    if (!name.trim()) {
      toast.error('Add a name');
      return;
    }
    if (blockedByContentFilter(name, hasNotes ? notes : null)) return;

    const target = dest;
    const item = {
      name,
      address: hasLocation ? address : null,
      latitude: hasLocation ? latitude : null,
      longitude: hasLocation ? longitude : null,
      picked: hasLocation ? picked : null,
    };

    setSaving(true);
    setProblem(null);
    let result: SaveResult;
    if (target.kind === 'restaurants') {
      result = await saveRestaurant(user.id, item, {
        status: placeStatus,
        folderIds,
        rating,
        priceLevel,
        notes,
        category: picked?.category ?? null,
        photos,
      });
    } else if (target.kind === 'custom') {
      result = await saveCustomListItem(user.id, target.list, item, {
        statusId: customStatusId ?? sortedStatuses[0]?.id ?? null,
        typeIds,
        priceLevel,
        priceManual,
        rating,
        ratingManual,
        notes,
        photos,
      });
    } else {
      result = await saveSharedListItem(user.id, target.listId, item, {
        status: placeStatus,
        priceLevel,
        notes,
      });
    }
    setSaving(false);

    // On either failure everything entered is kept, so the fix is one tap.
    if (result.status === 'duplicate') {
      setProblem(
        `This is already on ${target.label}. Pick another list, or change the name or address if it's a different place.`,
      );
      return;
    }
    if (result.status === 'error') {
      setProblem(`Couldn't add to ${target.label}: ${errorMessage(result.error, 'something went wrong')}. Try again.`);
      return;
    }

    void hapticSuccess();
    rememberDestination(target.key);
    invalidateDestination(target);
    toast.success(`Added to ${target.label}`, {
      action: { label: 'View', onClick: () => navigate(destinationPath(target)) },
    });
    onOpenChange(false);
  };

  // -- Render -------------------------------------------------------------------
  const destinationSummary =
    dest.kind === 'shared' ? `Shared with ${dest.partnerName}` : dest.kind === 'custom' ? 'Your list' : 'Places to eat & drink';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] gap-0 p-0">
        <div className="space-y-4 p-6 pb-4">
          <DialogHeader>
            <DialogTitle>Add item</DialogTitle>
            <DialogDescription className="sr-only">Add something to one of your lists.</DialogDescription>
          </DialogHeader>

          {/* Where it goes - first, because it decides the rest of the form. */}
          <div className="space-y-2">
            <Label htmlFor="add-item-destination">Add to</Label>
            <Select value={destKey} onValueChange={setDestKey} disabled={loadingDestinations}>
              <SelectTrigger id="add-item-destination" aria-describedby="add-item-destination-hint">
                <SelectValue>
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden>{dest.icon}</span>
                    <span className="truncate">{dest.label}</span>
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="restaurants">🍽️ My Restaurants</SelectItem>
                {(destinations?.custom.length ?? 0) > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>My lists</SelectLabel>
                      {destinations!.custom.map((d) => (
                        <SelectItem key={d.key} value={d.key}>
                          {d.icon} {d.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                )}
                {(destinations?.shared.length ?? 0) > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>Shared</SelectLabel>
                      {destinations!.shared.map((d) => (
                        <SelectItem key={d.key} value={d.key}>
                          {d.icon} {d.label} · with {d.kind === 'shared' ? d.partnerName : ''}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                )}
              </SelectContent>
            </Select>
            <p id="add-item-destination-hint" className="text-xs text-muted-foreground">
              {destinationsFailed ? "Couldn't load your lists - you can still add to My Restaurants." : destinationSummary}
            </p>
          </div>

          {hasLocation && (
            <div className="relative space-y-2">
              <Label htmlFor="add-item-search">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="add-item-search"
                  placeholder={dest.kind === 'custom' ? 'Search for a place…' : 'Search restaurants, cafés, bars…'}
                  value={searchQuery}
                  enterKeyHint="search"
                  autoComplete="off"
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setShowResults(true);
                  }}
                  onFocus={() => searchResults.length > 0 && setShowResults(true)}
                  className="pl-10"
                />
                {searching && (
                  <Spinner className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                )}
              </div>
              {dropdownVisible && (
                <PlaceResultsDropdown
                  results={searchResults}
                  searching={searching}
                  noResults={noResults}
                  onSelect={selectPlace}
                  onClose={() => setShowResults(false)}
                  className="absolute z-50 mt-1 max-h-[220px] w-full overflow-y-auto overscroll-contain rounded-md border bg-popover shadow-lg"
                />
              )}
              <p className="text-xs text-muted-foreground">Or type the details below</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="add-item-name">Name</Label>
            <Input
              id="add-item-name"
              placeholder={hasLocation ? 'Place name' : 'Item name'}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setProblem(null);
              }}
            />
          </div>

          {hasLocation && (
            <div className="space-y-2">
              <Label htmlFor="add-item-address">Address</Label>
              <Input
                id="add-item-address"
                placeholder="123 Main St, City"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
          )}

          {/* Status: To Go / Been There for places, the list's own statuses otherwise. */}
          {dest.kind === 'custom' ? (
            sortedStatuses.length > 0 && (
              <div className="space-y-2">
                <Label>Status</Label>
                {sortedStatuses.length <= 3 ? (
                  <Tabs value={customStatusId ?? undefined} onValueChange={setCustomStatusId}>
                    <TabsList className="w-full">
                      {sortedStatuses.map((s) => (
                        <TabsTrigger key={s.id} value={s.id} className="flex-1 truncate">
                          {s.name}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                ) : (
                  <Select value={customStatusId ?? undefined} onValueChange={setCustomStatusId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sortedStatuses.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )
          ) : (
            <div className="space-y-2">
              <Label>Status</Label>
              <Tabs value={placeStatus} onValueChange={(v) => setPlaceStatus(v as 'to_go' | 'went_to')}>
                <TabsList className="w-full">
                  <TabsTrigger value="to_go" className="flex-1">
                    To Go
                  </TabsTrigger>
                  <TabsTrigger value="went_to" className="flex-1">
                    Been There
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          )}

          {dest.kind === 'restaurants' && folders.length > 0 && (
            <div className="space-y-2">
              <Label>Types</Label>
              <TagMultiSelect options={folders} value={folderIds} onChange={setFolderIds} />
            </div>
          )}
          {dest.kind === 'custom' && types.length > 0 && (
            <div className="space-y-2">
              <Label>Types</Label>
              <TagMultiSelect options={types} value={typeIds} onChange={setTypeIds} />
            </div>
          )}

          {/* Rating: My Restaurants only rates places you've been to. */}
          {ratingScale && !(dest.kind === 'restaurants' && placeStatus === 'to_go') && (
            <div className="space-y-3">
              {ratingScale === 'ten' && (
                <>
                  <Label>Rating: {rating ?? 'Not rated'}/10</Label>
                  <Slider value={[rating ?? 5]} onValueChange={(v) => setRating(v[0])} min={0} max={10} step={1} />
                </>
              )}
              {ratingScale === 'five' && (
                <>
                  <Label>Rating: {rating ? `${rating}/5` : 'Not rated'}</Label>
                  <StarRatingPicker value={rating} onChange={setRating} />
                </>
              )}
              {ratingScale === 'manual' && (
                <>
                  <Label htmlFor="add-item-rating">Rating</Label>
                  <Input
                    id="add-item-rating"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    placeholder="e.g. 8.5"
                    value={ratingManual}
                    onChange={(e) => setRatingManual(e.target.value)}
                  />
                </>
              )}
            </div>
          )}

          {/* Less common details stay folded away so a quick add is quick. */}
          {(priceMode || hasNotes || hasPhotos) && (
            <div className="rounded-lg border">
              <button
                type="button"
                onClick={() => setMoreOpen((o) => !o)}
                aria-expanded={moreOpen}
                className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium"
              >
                <span>
                  More details
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    {[priceMode && 'price', hasNotes && 'notes', hasPhotos && 'photos'].filter(Boolean).join(', ')}
                  </span>
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
              </button>
              {moreOpen && (
                <div className="space-y-4 border-t px-3 pb-3 pt-3">
                  {priceMode === 'dollar' && (
                    <div className="space-y-1">
                      <Label>
                        Price: {priceLevel ? `${'$'.repeat(priceLevel)} (${PRICE_LABELS[priceLevel - 1]})` : 'Not set'}
                      </Label>
                      <PriceLevelPicker value={priceLevel} onChange={setPriceLevel} labels={PRICE_LABELS} />
                    </div>
                  )}
                  {priceMode === 'manual' && (
                    <div className="space-y-2">
                      <Label htmlFor="add-item-price">Price</Label>
                      <Input
                        id="add-item-price"
                        type="number"
                        inputMode="decimal"
                        step="any"
                        placeholder="e.g. 12.50"
                        value={priceManual}
                        onChange={(e) => setPriceManual(e.target.value)}
                      />
                    </div>
                  )}
                  {hasNotes && (
                    <div className="space-y-2">
                      <Label htmlFor="add-item-notes">Notes</Label>
                      <Textarea
                        id="add-item-notes"
                        placeholder="What to order, who recommended it…"
                        className="resize-none"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      />
                    </div>
                  )}
                  {hasPhotos && (
                    <div className="space-y-2">
                      <Label>
                        Photos ({photos.length}/{MAX_IMAGES_PER_ITEM})
                      </Label>
                      <div className="grid grid-cols-4 gap-2">
                        {photoPreviews.map((src, i) => (
                          <div key={i} className="relative aspect-square">
                            <img src={src} alt="" className="h-full w-full rounded-lg object-cover" />
                            <button
                              type="button"
                              onClick={() => removePhoto(i)}
                              aria-label="Remove photo"
                              className="absolute -right-2 -top-2 rounded-full bg-destructive p-1 text-destructive-foreground"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                        {photos.length < MAX_IMAGES_PER_ITEM && (
                          <label className="flex aspect-square cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-muted transition-colors hover:border-primary">
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              className="hidden"
                              onChange={(e) => void addFiles(Array.from(e.target.files || []))}
                            />
                            <ImagePlus className="h-6 w-6 text-muted-foreground" />
                            <span className="sr-only">Add photos</span>
                          </label>
                        )}
                        {isNative() && photos.length < MAX_IMAGES_PER_ITEM && (
                          <button
                            type="button"
                            aria-label="Take photo"
                            onClick={async () => {
                              const file = await capturePhoto();
                              if (file) void addFiles([file]);
                            }}
                            className="flex aspect-square items-center justify-center rounded-lg border-2 border-dashed border-muted transition-colors hover:border-primary"
                          >
                            <Camera className="h-6 w-6 text-muted-foreground" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pinned to the bottom of the dialog (which already sits inside the
            safe areas) so Add stays reachable however long the form gets,
            including while the keyboard is up. */}
        <div className="sticky bottom-0 z-10 space-y-2 border-t bg-background px-6 pb-4 pt-3">
          {problem && (
            <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{problem}</span>
            </p>
          )}
          <Button className="w-full" onClick={() => void handleSave()} disabled={saving || !name.trim()}>
            {saving && <Spinner className="mr-2 h-4 w-4 animate-spin" />}
            <span className="truncate">Add to {dest.label}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
