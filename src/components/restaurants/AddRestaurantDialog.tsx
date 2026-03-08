import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ImagePlus, Loader2, X, MapPin, Search, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const formSchema = z.object({
  name: z.string().min(1, 'Restaurant name is required'),
  address: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  notes: z.string().optional(),
  status: z.enum(['to_go', 'went_to']),
  folder_id: z.string().optional(),
  rating: z.number().min(0).max(10).optional(),
  price_level: z.number().min(1).max(4).optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface PlaceResult {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  mapboxId?: string;
}

interface AddRestaurantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: { id: string; name: string; color: string }[];
  onSuccess: () => void;
  onCreateType?: () => void;
}

const FOOD_EMOJIS = ['🍕', '🍔', '🍣', '🌮', '🍜', '🥗', '🍰', '🍝', '🥘', '🍱'];
const PRICE_LABELS = ['<$30', '<$50', '<$100', '$100+'];

function EmojiSlider({ 
  value, 
  onChange, 
  min, 
  max, 
  emojiIndex,
  labels,
}: { 
  value: number; 
  onChange: (v: number) => void; 
  min: number; 
  max: number;
  emojiIndex: number;
  labels?: string[];
}) {
  const percentage = ((value - min) / (max - min)) * 100;
  const emoji = FOOD_EMOJIS[emojiIndex % FOOD_EMOJIS.length];
  const count = max - min + 1;
  
  return (
    <div className="relative pt-2 pb-6">
      {/* Track background with numbers/labels */}
      <div className="relative h-8 bg-muted rounded-full overflow-hidden">
        {/* Filled portion */}
        <div 
          className="absolute left-0 h-full bg-primary/30 rounded-l-full transition-all duration-150"
          style={{ width: `${percentage}%` }}
        />
        {/* Number/label markers */}
        <div className="absolute inset-0 flex items-center justify-between px-2">
          {Array.from({ length: count }, (_, i) => (
            <span 
              key={i} 
              className={`text-xs font-medium transition-colors z-10 ${
                i + min <= value ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              {labels ? labels[i] : i + min}
            </span>
          ))}
        </div>
      </div>
      
      {/* Emoji thumb */}
      <div 
        className="absolute top-0 -translate-x-1/2 cursor-grab active:cursor-grabbing select-none text-2xl transition-all duration-150"
        style={{ left: `${percentage}%` }}
      >
        {emoji}
      </div>
      
      {/* Hidden range input for interaction */}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 w-full h-8 opacity-0 cursor-pointer"
      />
    </div>
  );
}

export function AddRestaurantDialog({
  open,
  onOpenChange,
  folders,
  onSuccess,
  onCreateType,
}: AddRestaurantDialogProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [sessionToken] = useState(() => crypto.randomUUID());
  
  // Random emoji indices for this session
  const emojiIndices = useMemo(() => ({
    rating: Math.floor(Math.random() * FOOD_EMOJIS.length),
    price: Math.floor(Math.random() * FOOD_EMOJIS.length),
  }), [open]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      address: '',
      latitude: undefined,
      longitude: undefined,
      notes: '',
      status: 'to_go',
      folder_id: undefined,
      rating: undefined,
      price_level: undefined,
    },
  });

  const watchStatus = form.watch('status');
  const isToGo = watchStatus === 'to_go';

  // Get user's location when dialog opens
  useEffect(() => {
    if (open && !userLocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          console.log('Location not available:', error.message);
        }
      );
    }
  }, [open, userLocation]);

  // Debounced search with location bias
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
      } catch (error) {
        console.error('Search error:', error);
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
        form.setValue('name', result.name);
        form.setValue('address', result.address);
        form.setValue('latitude', result.latitude);
        form.setValue('longitude', result.longitude);
      } catch (error) {
        console.error('Retrieve error:', error);
        form.setValue('name', place.name);
        form.setValue('address', place.address);
      }
    } else {
      form.setValue('name', place.name);
      form.setValue('address', place.address);
      form.setValue('latitude', place.latitude || undefined);
      form.setValue('longitude', place.longitude || undefined);
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const allFiles = Array.from(e.target.files || []);
    const files = allFiles.filter((file) => {
      const error = validateImageFile(file);
      if (error) {
        toast.error(`${file.name}: ${error}`);
        return false;
      }
      return true;
    });
    setImages((prev) => [...prev, ...files]);
    
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        setImagePreviews((prev) => [...prev, e.target?.result as string]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const onSubmit = async (values: FormValues) => {
    if (!user) return;
    
    setLoading(true);
    try {
      // Clear rating for to_go status, keep price_level for both
      const submitValues = {
        ...values,
        rating: isToGo ? null : values.rating || null,
        price_level: values.price_level || null,
      };

      const { data: restaurant, error: restaurantError } = await supabase
        .from('restaurants')
        .insert({
          user_id: user.id,
          name: submitValues.name,
          address: submitValues.address || null,
          latitude: submitValues.latitude || null,
          longitude: submitValues.longitude || null,
          notes: submitValues.notes || null,
          status: submitValues.status,
          folder_id: submitValues.folder_id || null,
          rating: submitValues.rating,
          price_level: submitValues.price_level,
          visited_at: submitValues.status === 'went_to' ? new Date().toISOString() : null,
        })
        .select()
        .single();

      if (restaurantError) throw restaurantError;

      if (images.length > 0) {
        for (const image of images) {
          const fileExt = image.name.split('.').pop();
          const fileName = `${user.id}/${restaurant.id}/${crypto.randomUUID()}.${fileExt}`;
          
          const { error: uploadError } = await supabase.storage
            .from('restaurant-images')
            .upload(fileName, image);

          if (uploadError) {
            console.error('Image upload error:', uploadError);
            continue;
          }

          const storagePath = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/restaurant-images/${fileName}`;

          await supabase.from('restaurant_images').insert({
            restaurant_id: restaurant.id,
            user_id: user.id,
            image_url: storagePath,
          });
        }
      }


      toast.success('Restaurant added successfully!');
      form.reset();
      setImages([]);
      setImagePreviews([]);
      setSearchQuery('');
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      toast.error(error.message || 'Failed to add restaurant');
    } finally {
      setLoading(false);
    }
  };

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      form.reset();
      setImages([]);
      setImagePreviews([]);
      setSearchQuery('');
      setSearchResults([]);
    }
  }, [open, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Place</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Place Search */}
            <div className="space-y-2">
              <FormLabel>Search Restaurant</FormLabel>
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
              
              {/* Search Results Dropdown */}
              {showResults && searchResults.length > 0 && (
                <div className="absolute z-50 w-full max-w-[468px] bg-popover border rounded-md shadow-lg mt-1 max-h-[200px] overflow-y-auto">
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
              <p className="text-xs text-muted-foreground">
                Search for a place or enter details manually below
              </p>
            </div>

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Restaurant name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input placeholder="123 Main St, City" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="to_go">To Go</SelectItem>
                        <SelectItem value="went_to">Been There</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="folder_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {folders.length === 0 ? (
                          <div className="p-2">
                            <p className="text-sm text-muted-foreground mb-2">No types yet</p>
                            {onCreateType && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full"
                                onClick={() => {
                                  onOpenChange(false);
                                  onCreateType();
                                }}
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Create New Type
                              </Button>
                            )}
                          </div>
                        ) : (
                          <>
                            {folders.map((folder) => (
                              <SelectItem key={folder.id} value={folder.id}>
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-3 h-3 rounded-full"
                                    style={{ backgroundColor: folder.color }}
                                  />
                                  {folder.name}
                                </div>
                              </SelectItem>
                            ))}
                            {onCreateType && (
                              <div className="border-t mt-1 pt-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="w-full justify-start"
                                  onClick={() => {
                                    onOpenChange(false);
                                    onCreateType();
                                  }}
                                >
                                  <Plus className="h-4 w-4 mr-2" />
                                  Create New Type
                                </Button>
                              </div>
                            )}
                          </>
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Price level - shown for both statuses */}
            <FormField
              control={form.control}
              name="price_level"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Price Level: {'$'.repeat(field.value || 0)} {field.value ? `(${PRICE_LABELS[field.value - 1]})` : 'Not set'}
                  </FormLabel>
                  <FormControl>
                    <EmojiSlider
                      value={field.value ?? 2}
                      onChange={field.onChange}
                      min={1}
                      max={4}
                      emojiIndex={emojiIndices.price}
                      labels={PRICE_LABELS}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Only show rating for "went_to" status */}
            {!isToGo && (
              <FormField
                control={form.control}
                name="rating"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rating: {field.value ?? 'Not rated'}/10</FormLabel>
                    <FormControl>
                      <EmojiSlider
                        value={field.value ?? 5}
                        onChange={field.onChange}
                        min={0}
                        max={10}
                        emojiIndex={emojiIndices.rating}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="What do you want to try? Add your thoughts..."
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <FormLabel>Photos</FormLabel>
              <div className="grid grid-cols-4 gap-2">
                {imagePreviews.map((preview, index) => (
                  <div key={index} className="relative aspect-square">
                    <img
                      src={preview}
                      alt="Preview"
                      className="w-full h-full object-cover rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <label className="aspect-square border-2 border-dashed border-muted rounded-lg flex items-center justify-center cursor-pointer hover:border-primary transition-colors">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageChange}
                    className="hidden"
                  />
                  <ImagePlus className="h-6 w-6 text-muted-foreground" />
                </label>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Place
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
