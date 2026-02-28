import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Plus, Beer, Wine } from 'lucide-react';
import { toast } from 'sonner';
import { AddCellarItemDialog } from '@/components/cellar/AddCellarItemDialog';
import { CellarItemCard } from '@/components/cellar/CellarItemCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface CellarItem {
  id: string;
  name: string;
  description: string | null;
  type: string;
  is_preset: boolean;
  created_at: string;
}

export default function Cellar() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<CellarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'beer' | 'wine'>('beer');

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  const fetchItems = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('cellar_items')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching cellar items:', error);
    } else {
      setItems(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (user) fetchItems();
  }, [user]);

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('cellar_items').delete().eq('id', id);
    if (error) {
      toast.error('Failed to delete');
    } else {
      toast.success('Removed from cellar');
      fetchItems();
    }
  };

  const beerItems = items.filter(i => i.type === 'beer');
  const wineItems = items.filter(i => i.type === 'wine');
  const currentItems = activeTab === 'beer' ? beerItems : wineItems;

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Cellar</h1>
            <p className="text-muted-foreground mt-1">Track the beers and wines you've tried</p>
          </div>
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Drink
          </Button>
        </div>

        <Card>
          <CardContent className="p-4">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'beer' | 'wine')}>
              <TabsList className="mb-4">
                <TabsTrigger value="beer" className="flex items-center gap-2">
                  <Beer className="h-4 w-4" />
                  Beers ({beerItems.length})
                </TabsTrigger>
                <TabsTrigger value="wine" className="flex items-center gap-2">
                  <Wine className="h-4 w-4" />
                  Wines ({wineItems.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="beer">
                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : beerItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Beer className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No beers in your cellar yet</p>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                    {beerItems.map(item => (
                      <CellarItemCard key={item.id} item={item} onDelete={handleDelete} onUpdate={fetchItems} />
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="wine">
                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : wineItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Wine className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No wines in your cellar yet</p>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                    {wineItems.map(item => (
                      <CellarItemCard key={item.id} item={item} onDelete={handleDelete} onUpdate={fetchItems} />
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </main>

      <AddCellarItemDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} onSuccess={fetchItems} />
    </div>
  );
}
