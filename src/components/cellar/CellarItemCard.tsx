import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Beer, Wine, Trash2, Pencil, Check, X, Star } from 'lucide-react';

interface CellarItem {
  id: string;
  name: string;
  description: string | null;
  type: string;
  is_preset: boolean;
  rating: number | null;
}

interface CellarItemCardProps {
  item: CellarItem;
  onDelete: (id: string) => void;
  onUpdate: () => void;
}

export function CellarItemCard({ item, onDelete, onUpdate }: CellarItemCardProps) {
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState(item.description || '');
  const [editRating, setEditRating] = useState(item.rating?.toString() || '');

  const handleSaveDescription = async () => {
    const parsedRating = editRating ? parseFloat(editRating) : null;
    if (parsedRating !== null && (isNaN(parsedRating) || parsedRating < 0 || parsedRating > 10)) {
      toast.error('Rating must be between 0 and 10');
      return;
    }
    const { error } = await supabase
      .from('cellar_items')
      .update({ description: desc.trim() || null, rating: parsedRating })
      .eq('id', item.id);

    if (error) {
      toast.error('Failed to update');
    } else {
      toast.success('Updated!');
      setEditing(false);
      onUpdate();
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="mt-0.5 p-2 rounded-full bg-primary/10">
              {item.type === 'wine' ? <Wine className="h-4 w-4 text-primary" /> : <Beer className="h-4 w-4 text-primary" />}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm">{item.name}</h3>
              {item.rating !== null && !editing && (
                <div className="flex items-center gap-1 mt-0.5">
                  <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                  <span className="text-xs font-medium">{item.rating}/10</span>
                </div>
              )}
              {editing ? (
                <div className="mt-2 space-y-2">
                  <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} className="text-sm" />
                  <div>
                    <label className="text-xs text-muted-foreground">Rating (0-10)</label>
                    <Input type="number" step="0.1" min="0" max="10" placeholder="e.g. 7.5" value={editRating} onChange={(e) => setEditRating(e.target.value)} className="text-sm" />
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                      <X className="h-3 w-3" />
                    </Button>
                    <Button size="sm" onClick={handleSaveDescription}>
                      <Check className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-3">
                  {item.description || 'No description'}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditing(!editing)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => onDelete(item.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
