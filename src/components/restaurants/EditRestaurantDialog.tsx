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

interface Restaurant {
  id: string;
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  rating?: number | null;
  price_level?: number | null;
  status: string;
  notes?: string | null;
  folder_id?: string | null;
  folder?: { name: string; color: string } | null;
  images?: { image_url: string; id: string }[];
}

interface EditRestaurantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurant: Restaurant | null;
  folders: { id: string; name: string; color: string }[];
  onSuccess: () => void;
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

export function EditRestaurantDialog({
  open,
  onOpenChange,
  restaurant,
  folders,
  onSuccess,
}: EditRestaurantDialogProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  
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

  // Populate form when restaurant changes
  useEffect(() => {
    if (restaurant && open) {
      form.reset({
        name: restaurant.name,
        address: restaurant.address || '',
        latitude: restaurant.latitude || undefined,
        longitude: restaurant.longitude || undefined,
        notes: restaurant.notes || '',
        status: restaurant.status as 'to_go' | 'went_to',
        folder_id: restaurant.folder_id || undefined,
        rating: restaurant.rating || undefined,
        price_level: restaurant.price_level || undefined,
      });
    }
  }, [restaurant, open, form]);

  const onSubmit = async (values: FormValues) => {
    if (!user || !restaurant) return;
    
    setLoading(true);
    try {
      const submitValues = {
        ...values,
        rating: isToGo ? null : values.rating || null,
        price_level: values.price_level || null,
      };

      const { error } = await supabase
        .from('restaurants')
        .update({
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
        .eq('id', restaurant.id);

      if (error) throw error;

      toast.success('Restaurant updated successfully!');
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update restaurant');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Restaurant</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
                    <Select onValueChange={field.onChange} value={field.value}>
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
                    <Select onValueChange={field.onChange} value={field.value || ''}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="">No Type</SelectItem>
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

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
