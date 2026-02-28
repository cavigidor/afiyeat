import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { beerPresets, BeerPreset } from '@/data/beerPresets';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Beer, Wine, Search, Plus } from 'lucide-react';

interface AddCellarItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  drinkType: 'beer' | 'wine';
}

export function AddCellarItemDialog({ open, onOpenChange, onSuccess, drinkType }: AddCellarItemDialogProps) {
  const { user } = useAuth();
  const [mode, setMode] = useState<'preset' | 'manual'>(drinkType === 'wine' ? 'manual' : 'preset');
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rating, setRating] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<BeerPreset | null>(null);
  const [saving, setSaving] = useState(false);

  const filteredPresets = useMemo(() => {
    if (!search) return beerPresets;
    const lower = search.toLowerCase();
    return beerPresets.filter(b => b.name.toLowerCase().includes(lower));
  }, [search]);

  const handleSelectPreset = (preset: BeerPreset) => {
    setSelectedPreset(preset);
    setName(preset.name);
    setDescription(preset.description);
  };

  const handleSave = async () => {
    if (!user || !name.trim()) return;
    setSaving(true);

    const parsedRating = rating ? parseFloat(rating) : null;
    if (parsedRating !== null && (isNaN(parsedRating) || parsedRating < 0 || parsedRating > 10)) {
      toast.error('Rating must be between 0 and 10');
      setSaving(false);
      return;
    }

    const { error } = await supabase.from('cellar_items').insert({
      user_id: user.id,
      name: name.trim(),
      description: description.trim() || null,
      type: drinkType,
      is_preset: !!selectedPreset,
      rating: parsedRating,
    });

    if (error) {
      toast.error('Failed to add item');
    } else {
      toast.success(`${name} added to your cellar!`);
      onSuccess();
      resetAndClose();
    }
    setSaving(false);
  };

  const resetAndClose = () => {
    setName('');
    setDescription('');
    setRating('');
    setSearch('');
    setSelectedPreset(null);
    setMode(drinkType === 'wine' ? 'manual' : 'preset');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {drinkType === 'wine' ? <Wine className="h-5 w-5" /> : <Beer className="h-5 w-5" />}
            Add {drinkType === 'wine' ? 'Wine' : 'Beer'}
          </DialogTitle>
        </DialogHeader>

        {drinkType === 'wine' ? (
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input placeholder="Enter wine name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea placeholder="Describe the wine..." value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
            </div>
            <div>
              <Label>Rating (0-10)</Label>
              <Input type="number" step="0.1" min="0" max="10" placeholder="e.g. 7.5" value={rating} onChange={(e) => setRating(e.target.value)} />
            </div>
          </div>
        ) : (
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'preset' | 'manual')}>
          <TabsList className="w-full">
            <TabsTrigger value="preset" className="flex-1">Choose from List</TabsTrigger>
            <TabsTrigger value="manual" className="flex-1">Add Manually</TabsTrigger>
          </TabsList>

          <TabsContent value="preset" className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search beers..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <ScrollArea className="h-[250px] border rounded-md">
              <div className="p-2 space-y-1">
                {filteredPresets.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => handleSelectPreset(preset)}
                    className={`w-full text-left p-3 rounded-md transition-colors ${
                      selectedPreset?.name === preset.name
                        ? 'bg-primary/10 border border-primary/30'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <p className="font-medium text-sm">{preset.name}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{preset.description}</p>
                  </button>
                ))}
                {filteredPresets.length === 0 && (
                  <p className="text-center text-muted-foreground py-8 text-sm">No beers found</p>
                )}
              </div>
            </ScrollArea>

            {selectedPreset && (
              <div className="space-y-3 border-t pt-3">
                <div>
                  <Label>Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <Label>Description (editable)</Label>
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
                </div>
                <div>
                  <Label>Rating (0-10)</Label>
                  <Input type="number" step="0.1" min="0" max="10" placeholder="e.g. 7.5" value={rating} onChange={(e) => setRating(e.target.value)} />
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="manual" className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input placeholder="Enter beer name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea placeholder="Describe the beer..." value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
            </div>
            <div>
              <Label>Rating (0-10)</Label>
              <Input type="number" step="0.1" min="0" max="10" placeholder="e.g. 7.5" value={rating} onChange={(e) => setRating(e.target.value)} />
            </div>
          </TabsContent>
        </Tabs>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={resetAndClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            <Plus className="h-4 w-4 mr-2" />
            {saving ? 'Adding...' : 'Add to Cellar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
