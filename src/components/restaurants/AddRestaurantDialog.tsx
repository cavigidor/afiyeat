import { useState, useEffect, useCallback } from 'react';
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
import { Slider } from '@/components/ui/slider';
import { ImagePlus, Loader2, X, MapPin, Search } from 'lucide-react';
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
  rating: z.number().min(1).max(5).optional(),
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
}

export function AddRestaurantDialog({
  open,
  onOpenChange,
  folders,
  onSuccess,
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
          // Default to a central location if geolocation fails
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
    
    // If we need to retrieve coordinates, call the retrieve endpoint
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
        // Fall back to basic info
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
    const files = Array.from(e.target.files || []);
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
      const { data: restaurant, error: restaurantError } = await supabase
        .from('restaurants')
        .insert({
          user_id: user.id,
          name: values.name,
          address: values.address || null,
          latitude: values.latitude || null,
          longitude: values.longitude || null,
          notes: values.notes || null,
          status: values.status,
          folder_id: values.folder_id || null,
          rating: values.rating || null,
          price_level: values.price_level || null,
          visited_at: values.status === 'went_to' ? new Date().toISOString() : null,
        })
        .select()
        .single();

      if (restaurantError) throw restaurantError;

      // Upload images
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

        const { data: { publicUrl } } = supabase.storage
          .from('restaurant-images')
          .getPublicUrl(fileName);

        await supabase.from('restaurant_images').insert({
          restaurant_id: restaurant.id,
          user_id: user.id,
          image_url: publicUrl,
        });
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
          <DialogTitle>Add Restaurant</DialogTitle>
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
                        <SelectItem value="went_to">Went To</SelectItem>
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
                    <FormLabel>Folder</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select folder" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
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
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="rating"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rating: {field.value || 'Not rated'}</FormLabel>
                  <FormControl>
                    <Slider
                      min={1}
                      max={5}
                      step={1}
                      value={field.value ? [field.value] : [3]}
                      onValueChange={(v) => field.onChange(v[0])}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="price_level"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Price Level: {'$'.repeat(field.value || 0) || 'Not set'}
                  </FormLabel>
                  <FormControl>
                    <Slider
                      min={1}
                      max={4}
                      step={1}
                      value={field.value ? [field.value] : [2]}
                      onValueChange={(v) => field.onChange(v[0])}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
              Add Restaurant
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
