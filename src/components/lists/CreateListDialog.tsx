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
import { Loader2, MapPin, DollarSign, Star, StickyNote, ImageIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { FOLDER_COLORS } from '@/hooks/useFolderManagement';

export type ValueField = 'none' | 'price' | 'rating';

export interface CustomList {
  id: string;
  name: string;
  icon: string;
  color: string;
  show_location: boolean;
  value_field: ValueField;
  show_notes: boolean;
  show_photos: boolean;
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

// A generic, non-food-specific icon set (unlike the restaurant folder
// system's food emojis) since these lists are for anything - movies, beers,
// books, whatever the user wants to track.
const LIST_ICONS = ['📋', '🎬', '📺', '🍺', '📚', '🎮', '🍷', '✈️', '🎵', '☕', '🏋️', '🛍️', '🐾'];

// A blank "List name" field with no other context is a hard place to start,
// so offer a few concrete, common ideas as one-tap chips. Picking one fills
// in both the name and a matching icon, rather than just the text, so it
// reads as a real starting point rather than a random label.
const LIST_SUGGESTIONS: { label: string; icon: string }[] = [
  { label: 'Movies', icon: '🎬' },
  { label: 'Shows', icon: '📺' },
  { label: 'Concerts', icon: '🎵' },
  { label: 'Books', icon: '📚' },
];

export function CreateListDialog({ open, onOpenChange, onSuccess, editList }: CreateListDialogProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(LIST_ICONS[0]);
  const [color, setColor] = useState(FOLDER_COLORS[0]);
  const [showLocation, setShowLocation] = useState(true);
  const [valueField, setValueField] = useState<ValueField>('price');
  const [showNotes, setShowNotes] = useState(true);
  const [showPhotos, setShowPhotos] = useState(true);
  const [todoLabel, setTodoLabel] = useState('');
  const [doneLabel, setDoneLabel] = useState('');

  const isEditing = !!editList;

  useEffect(() => {
    if (!open) return;
    if (editList) {
      setName(editList.name);
      setIcon(editList.icon);
      setColor(editList.color);
      setShowLocation(editList.show_location);
      setValueField(editList.value_field);
      setShowNotes(editList.show_notes);
      setShowPhotos(editList.show_photos);
      setTodoLabel(editList.status_todo_label);
      setDoneLabel(editList.status_done_label);
    } else {
      setName('');
      setIcon(LIST_ICONS[0]);
      setColor(FOLDER_COLORS[0]);
      setShowLocation(true);
      setValueField('price');
      setShowNotes(true);
      setShowPhotos(true);
      setTodoLabel('');
      setDoneLabel('');
    }
  }, [open, editList]);

  const handleSubmit = async () => {
    if (!user) return;
    if (!name.trim()) {
      toast.error('Give your list a name');
      return;
    }
    setLoading(true);

    const payload = {
      name: name.trim(),
      icon,
      color,
      show_location: showLocation,
      value_field: valueField,
      show_notes: showNotes,
      show_photos: showPhotos,
      status_todo_label: todoLabel.trim() || 'To Do',
      status_done_label: doneLabel.trim() || 'Done',
    };

    const { error } = isEditing
      ? await supabase.from('custom_lists').update(payload).eq('id', editList!.id)
      : await supabase.from('custom_lists').insert({ ...payload, user_id: user.id });

    setLoading(false);

    if (error) {
      toast.error(isEditing ? 'Failed to update list' : 'Failed to create list');
      console.error(error);
    } else {
      toast.success(isEditing ? 'List updated!' : 'List created!');
      onOpenChange(false);
      onSuccess();
    }
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
                <span className="text-xs text-muted-foreground mr-0.5">Need ideas?</span>
                {LIST_SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => { setName(s.label); setIcon(s.icon); }}
                    className="text-xs px-2.5 py-1 rounded-full bg-muted/60 hover:bg-muted transition-colors"
                  >
                    {s.icon} {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-2">
              {LIST_ICONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setIcon(emoji)}
                  className={`w-10 h-10 rounded-lg text-lg flex items-center justify-center border-2 transition-colors ${
                    icon === emoji ? 'border-primary bg-primary/10' : 'border-transparent bg-muted/50 hover:bg-muted'
                  }`}
                  aria-label={`Icon ${emoji}`}
                  aria-pressed={icon === emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-1.5">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full transition-transform ${
                    color === c ? 'ring-2 ring-primary ring-offset-2' : ''
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Color ${c}`}
                  aria-pressed={color === c}
                />
              ))}
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-sm font-medium">What to include when adding items</p>
            <p className="text-xs text-muted-foreground -mt-2">
              Turn off what doesn't apply - a beer list probably doesn't need an address, a book
              list probably doesn't need a price.
            </p>

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
              <div className="flex items-center gap-2">
                {valueField === 'rating' ? (
                  <Star className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <DollarSign className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <p className="text-sm">Price / rating indicator</p>
              </div>
              <Select value={valueField} onValueChange={(v) => setValueField(v as ValueField)}>
                <SelectTrigger className="ml-6 w-[calc(100%-1.5rem)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Off</SelectItem>
                  <SelectItem value="price">Price ($ - $$$$)</SelectItem>
                  <SelectItem value="rating">Rating (0-10)</SelectItem>
                </SelectContent>
              </Select>
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

          <div className="space-y-2">
            <Label>Status labels (optional)</Label>
            <p className="text-xs text-muted-foreground -mt-1">
              Rename the two stages, e.g. "To Watch" / "Watched" for movies.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="To Do" value={todoLabel} onChange={(e) => setTodoLabel(e.target.value)} />
              <Input placeholder="Done" value={doneLabel} onChange={(e) => setDoneLabel(e.target.value)} />
            </div>
          </div>

          <Button className="w-full" onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? 'Save Changes' : 'Create List'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
