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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { EmojiSlider, PRICE_LABELS } from './EmojiSlider';

export interface SharedItem {
  id: string;
  name: string;
  address: string | null;
  status: string;
  rating: number | null;
  price_level: number | null;
  notes: string | null;
}

interface EditSharedItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: SharedItem | null;
  onSuccess: () => void;
}

export function EditSharedItemDialog({ open, onOpenChange, item, onSuccess }: EditSharedItemDialogProps) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<'to_go' | 'went_to'>('to_go');
  const [rating, setRating] = useState<number | null>(null);
  const [priceLevel, setPriceLevel] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  const emojiIndices = useMemo(
    () => ({ rating: Math.floor(Math.random() * 10), price: Math.floor(Math.random() * 10) }),
    [open]
  );

  useEffect(() => {
    if (item) {
      setName(item.name);
      setAddress(item.address || '');
      setStatus(item.status === 'went_to' ? 'went_to' : 'to_go');
      setRating(item.rating);
      setPriceLevel(item.price_level);
      setNotes(item.notes || '');
    }
  }, [item]);

  const isToGo = status === 'to_go';

  const handleSubmit = async () => {
    if (!item) return;
    if (!name.trim()) {
      toast.error('Add a place name');
      return;
    }
    setLoading(true);
    const { error } = await supabase
      .from('shared_list_items')
      .update({
        name: name.trim(),
        address: address.trim() || null,
        status,
        rating: isToGo ? null : rating,
        price_level: priceLevel,
        notes: notes.trim() || null,
        visited_at: status === 'went_to' ? new Date().toISOString() : null,
      })
      .eq('id', item.id);
    setLoading(false);

    if (error) {
      toast.error('Failed to save changes');
      console.error(error);
    } else {
      toast.success('Updated!');
      onOpenChange(false);
      onSuccess();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Place</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
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
            <EmojiSlider
              value={priceLevel ?? 2}
              onChange={setPriceLevel}
              min={1}
              max={4}
              emojiIndex={emojiIndices.price}
              labels={PRICE_LABELS}
            />
          </div>

          {!isToGo && (
            <div className="space-y-1">
              <Label>Shared Rating: {rating ?? 'Not rated'}/10</Label>
              <EmojiSlider
                value={rating ?? 5}
                onChange={setRating}
                min={0}
                max={10}
                emojiIndex={emojiIndices.rating}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Comment</Label>
            <Textarea
              className="resize-none"
              placeholder="Shared notes about this place..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <Button className="w-full" onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
