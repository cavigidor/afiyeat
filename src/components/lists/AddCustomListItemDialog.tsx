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
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, MapPin, Search, ImagePlus, X, Camera } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { isNative, capturePhoto } from '@/lib/native';
import { validateImageFile, compressImage, MAX_IMAGES_PER_ITEM } from '@/lib/imageValidation';
import { PriceLevelPicker } from '@/components/restaurants/PriceLevelPicker';
import { StarRatingPicker } from '@/components/lists/StarRatingPicker';
import { useSignedImageUrls } from '@/hooks/useSignedImageUrl';
import { GetDirectionsButton } from '@/components/shared/GetDirectionsButton';
import { isDuplicateCustomListItem } from '@/lib/duplicateRestaurant';
import type { CustomList } from './CreateListDialog';
import type { ManagedListType } from '@/hooks/useListTypeManagement';

const PRICE_LABELS = ['<$30', '<$50', '<$100', '$100+'];

interface PlaceResult {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  mapboxId?: string;
}

export interface CustomListItem {
  id: string;
  list_id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  price_level: number | null;
  price_manual: number | null;
  rating: number | null;
  rating_manual: number | null;
  notes: string | null;
  status: 'todo' | 'done';
  type_id: string | null;
  type?: { name: string; color: string; icon: string | null } | null;
  images?: { id: string; image_url: string }[];
}

interface AddCustomListItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: CustomList;
  // Types available to assign this item to - empty when the list has none
  // set up yet (see ListTypesManager, managed from the list page's Modify
  // mode).
  types?: ManagedListType[];
  onSuccess: () => void;
  // Presence of this triggers edit mode (same fields, pre-filled).
  editItem?: CustomListItem | null;
}

export function AddCustomListItemDialog({
  open,
  onOpenChange,
  list,
  types = [],
  onSuccess,
  editItem,
}: AddCustomListItemDialogProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [status, setStatus] = useState<'todo' | 'done'>('todo');
  const [typeId, setTypeId] = useState<string | null>(null);
  const [priceLevel, setPriceLevel] = useState<number | null>(null);
  const [priceManual, setPriceManual] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [ratingManual, setRatingManual] = useState('');
  const [notes, setNotes] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [existingImages, setExistingImages] = useState<{ id: string; image_url: string }[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<string[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [sessionToken] = useState(() => crypto.randomUUID());

  const isEditing = !!editItem;

  useEffect(() => {
    if (!open) return;
    if (editItem) {
      setName(editItem.name);
      setAddress(editItem.address || '');
      setLatitude(editItem.latitude);
      setLongitude(editItem.longitude);
      setStatus(editItem.status);
      setTypeId(editItem.type_id ?? null);
      setPriceLevel(editItem.price_level);
      setPriceManual(editItem.price_manual != null ? String(editItem.price_manual) : '');
      setRating(editItem.rating);
      setRatingManual(editItem.rating_manual != null ? String(editItem.rating_manual) : '');
      setNotes(editItem.notes || '');
      setExistingImages(editItem.images || []);
    } else {
      setName('');
      setAddress('');
      setLatitude(null);
      setLongitude(null);
      setStatus('todo');
      setTypeId(null);
      setPriceLevel(null);
      setPriceManual('');
      setRating(null);
      setRatingManual('');
      setNotes('');
      setExistingImages([]);
    }
    setImages([]);
    setImagePreviews([]);
    setRemovedImageIds([]);
    setSearchQuery('');
    setSearchResults([]);
  }, [open, editItem]);

  useEffect(() => {
    if (open && list.show_location && !userLocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => setUserLocation({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => {},
      );
    }
  }, [open, list.show_location, userLocation]);

  useEffect(() => {
    if (!list.show_location || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timeoutId = setTimeout(async () => {
      setSearching(true);
      try {
        const { data, error } = await supabase.functions.invoke('place-search', {
          body: { query: searchQuery, latitude: userLocation?.lat, longitude: userLocation?.lng, sessionToken },
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
  }, [searchQuery, userLocation, list.show_location]);

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

  const addFiles = async (incoming: File[]) => {
    const remainingSlots = MAX_IMAGES_PER_ITEM - existingImages.length - images.length;
    if (remainingSlots <= 0) {
      toast.error(`You can add up to ${MAX_IMAGES_PER_ITEM} photos per item.`);
      return;
    }
    const validated = incoming.filter((file) => {
      const error = validateImageFile(file);
      if (error) {
        toast.error(`${file.name}: ${error}`);
        return false;
      }
      return true;
    });
    const toAdd = validated.slice(0, remainingSlots);
    const compressed = await Promise.all(toAdd.map((file) => compressImage(file)));
    setImages((prev) => [...prev, ...compressed]);
    compressed.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => setImagePreviews((prev) => [...prev, e.target?.result as string]);
      reader.readAsDataURL(file);
    });
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => addFiles(Array.from(e.target.files || []));
  const handleTakePhoto = async () => {
    const file = await capturePhoto();
    if (file) addFiles([file]);
  };
  const removeNewImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };
  const removeExistingImage = (id: string) => {
    setExistingImages((prev) => prev.filter((img) => img.id !== id));
    setRemovedImageIds((prev) => [...prev, id]);
  };

  const totalPhotoCount = existingImages.length + imagePreviews.length;
  // custom-list-images is a private bucket - the stored image_url isn't
  // directly loadable, it needs to be exchanged for a signed URL first.
  const { signedUrls: existingImageSignedUrls } = useSignedImageUrls(
    existingImages.map((img) => img.image_url),
  );

  const handleSubmit = async () => {
    if (!user) return;
    if (!name.trim()) {
      toast.error('Add a name');
      return;
    }
    setLoading(true);
    try {
      if (!isEditing) {
        const duplicate = await isDuplicateCustomListItem(list.id, {
          name,
          latitude: list.show_location ? latitude : null,
          longitude: list.show_location ? longitude : null,
        });
        if (duplicate) {
          toast.error("This is already on this list. Add it again if it's a different location.");
          setLoading(false);
          return;
        }
      }

      const parsedPriceManual = priceManual.trim() ? parseFloat(priceManual) : null;
      const parsedRatingManual = ratingManual.trim() ? parseFloat(ratingManual) : null;

      const payload = {
        name: name.trim(),
        address: list.show_location ? address.trim() || null : null,
        latitude: list.show_location ? latitude : null,
        longitude: list.show_location ? longitude : null,
        type_id: typeId,
        price_level: list.show_price && list.price_mode === 'dollar' ? priceLevel : null,
        price_manual:
          list.show_price && list.price_mode === 'manual' && parsedPriceManual != null && !Number.isNaN(parsedPriceManual)
            ? parsedPriceManual
            : null,
        rating: list.show_rating && list.rating_mode !== 'manual' ? rating : null,
        rating_manual:
          list.show_rating && list.rating_mode === 'manual' && parsedRatingManual != null && !Number.isNaN(parsedRatingManual)
            ? parsedRatingManual
            : null,
        notes: list.show_notes ? notes.trim() || null : null,
        status,
        completed_at: status === 'done' ? new Date().toISOString() : null,
      };

      let itemId = editItem?.id;
      if (isEditing) {
        const { error } = await supabase.from('custom_list_items').update(payload).eq('id', itemId!);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('custom_list_items')
          .insert({ ...payload, list_id: list.id, user_id: user.id })
          .select()
          .single();
        if (error) throw error;
        itemId = data.id;
      }

      if (removedImageIds.length > 0) {
        await supabase.from('custom_list_item_images').delete().in('id', removedImageIds);
      }

      if (images.length > 0 && itemId) {
        for (const image of images) {
          const fileExt = image.name.split('.').pop();
          const fileName = `${user.id}/${itemId}/${crypto.randomUUID()}.${fileExt}`;
          const { error: uploadError } = await supabase.storage.from('custom-list-images').upload(fileName, image);
          if (uploadError) {
            console.error('Image upload error:', uploadError);
            continue;
          }
          const storagePath = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/custom-list-images/${fileName}`;
          await supabase.from('custom_list_item_images').insert({
            item_id: itemId,
            user_id: user.id,
            image_url: storagePath,
          });
        }
      }

      toast.success(isEditing ? 'Item updated!' : `Added to ${list.name}!`);
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save item');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Item' : `Add to ${list.name}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {list.show_location && (
            <div className="space-y-2 relative">
              <Label>Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search for a place..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setShowResults(true); }}
                  onFocus={() => searchResults.length > 0 && setShowResults(true)}
                  className="pl-10"
                />
                {searching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
              {showResults && searchResults.length > 0 && (
                <div className="absolute z-50 w-full bg-popover border rounded-md shadow-lg mt-1 max-h-[200px] overflow-y-auto overscroll-contain">
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
              <p className="text-xs text-muted-foreground">Or fill in details manually below</p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Name</Label>
            <Input placeholder="Item name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {list.show_location && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Address</Label>
                <GetDirectionsButton
                  latitude={latitude}
                  longitude={longitude}
                  address={address}
                  name={name}
                  size="sm"
                />
              </div>
              <Input placeholder="123 Main St, City" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
          )}

          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as 'todo' | 'done')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todo">{list.status_todo_label}</SelectItem>
                <SelectItem value="done">{list.status_done_label}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {types.length > 0 && (
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={typeId ?? '__none__'}
                onValueChange={(v) => setTypeId(v === '__none__' ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No Type</SelectItem>
                  {types.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      <div className="flex items-center gap-2">
                        {type.icon ? (
                          <span className="text-xs leading-none">{type.icon}</span>
                        ) : (
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: type.color }} />
                        )}
                        {type.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {list.show_price && (
            <div className="space-y-1">
              {list.price_mode === 'dollar' ? (
                <>
                  <Label>
                    Price: {priceLevel ? `${'$'.repeat(priceLevel)} (${PRICE_LABELS[priceLevel - 1]})` : 'Not set'}
                  </Label>
                  <PriceLevelPicker value={priceLevel} onChange={setPriceLevel} labels={PRICE_LABELS} />
                </>
              ) : (
                <>
                  <Label>Price</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    placeholder="e.g. 12.50"
                    value={priceManual}
                    onChange={(e) => setPriceManual(e.target.value)}
                  />
                </>
              )}
            </div>
          )}

          {list.show_rating && (
            <div className="space-y-3">
              {list.rating_mode === 'scale_10' && (
                <>
                  <Label>Rating: {rating ?? 'Not rated'}/10</Label>
                  <Slider
                    value={[rating ?? 5]}
                    onValueChange={(v) => setRating(v[0])}
                    min={0}
                    max={10}
                    step={1}
                  />
                </>
              )}
              {list.rating_mode === 'stars_5' && (
                <>
                  <Label>Rating: {rating ? `${rating}/5` : 'Not rated'}</Label>
                  <StarRatingPicker value={rating} onChange={setRating} />
                </>
              )}
              {list.rating_mode === 'manual' && (
                <>
                  <Label>Rating</Label>
                  <Input
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

          {list.show_notes && (
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                placeholder="Any thoughts, links, reminders..."
                className="resize-none"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          )}

          {list.show_photos && (
            <div className="space-y-2">
              <Label>Photos ({totalPhotoCount}/{MAX_IMAGES_PER_ITEM})</Label>
              <div className="grid grid-cols-4 gap-2">
                {existingImages.map((img, i) => (
                  <div key={img.id} className="relative aspect-square">
                    <img
                      src={existingImageSignedUrls[i] || ''}
                      alt=""
                      className="w-full h-full object-cover rounded-lg bg-muted"
                    />
                    <button
                      type="button"
                      onClick={() => removeExistingImage(img.id)}
                      className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {imagePreviews.map((preview, index) => (
                  <div key={index} className="relative aspect-square">
                    <img src={preview} alt="Preview" className="w-full h-full object-cover rounded-lg" />
                    <button
                      type="button"
                      onClick={() => removeNewImage(index)}
                      className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {totalPhotoCount < MAX_IMAGES_PER_ITEM && (
                  <label className="aspect-square border-2 border-dashed border-muted rounded-lg flex items-center justify-center cursor-pointer hover:border-primary transition-colors">
                    <input type="file" accept="image/*" multiple onChange={handleImageChange} className="hidden" />
                    <ImagePlus className="h-6 w-6 text-muted-foreground" />
                  </label>
                )}
                {isNative() && totalPhotoCount < MAX_IMAGES_PER_ITEM && (
                  <button
                    type="button"
                    onClick={handleTakePhoto}
                    className="aspect-square border-2 border-dashed border-muted rounded-lg flex items-center justify-center cursor-pointer hover:border-primary transition-colors"
                    aria-label="Take photo"
                  >
                    <Camera className="h-6 w-6 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>
          )}

          <Button className="w-full" onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? 'Save Changes' : 'Add Item'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
