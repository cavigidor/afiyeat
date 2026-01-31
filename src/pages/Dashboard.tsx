import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Navbar } from '@/components/layout/Navbar';
import { RestaurantCard } from '@/components/restaurants/RestaurantCard';
import { AddRestaurantDialog } from '@/components/restaurants/AddRestaurantDialog';
import { FolderList } from '@/components/folders/FolderList';
import { RestaurantSearch } from '@/components/restaurants/RestaurantSearch';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Plus, MapPin, Clock, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Restaurant {
  id: string;
  name: string;
  address: string | null;
  rating: number | null;
  price_level: number | null;
  status: string;
  notes: string | null;
  folder_id: string | null;
  folder?: { name: string; color: string } | null;
  images?: { image_url: string }[];
}

interface Folder {
  id: string;
  name: string;
  color: string;
}

export default function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('all');
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  const fetchFolders = async () => {
    if (!user) return;
    
    const { data, error } = await supabase
      .from('folders')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching folders:', error);
    } else {
      setFolders(data || []);
    }
  };

  const fetchRestaurants = async () => {
    if (!user) return;
    
    setLoading(true);
    let query = supabase
      .from('restaurants')
      .select(`
        *,
        folder:folders(name, color),
        images:restaurant_images(image_url)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (selectedFolder) {
      query = query.eq('folder_id', selectedFolder);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching restaurants:', error);
    } else {
      setRestaurants(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (user) {
      fetchFolders();
      fetchRestaurants();
    }
  }, [user, selectedFolder]);

  const handleMarkVisited = async (id: string) => {
    const { error } = await supabase
      .from('restaurants')
      .update({ status: 'went_to', visited_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      toast.error('Failed to update restaurant');
    } else {
      toast.success('Marked as been there!');
      fetchRestaurants();
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('restaurants').delete().eq('id', id);

    if (error) {
      toast.error('Failed to delete restaurant');
    } else {
      toast.success('Restaurant deleted');
      fetchRestaurants();
    }
  };

  const filteredRestaurants = restaurants.filter((r) => {
    if (activeTab === 'to_go') return r.status === 'to_go';
    if (activeTab === 'went_to') return r.status === 'went_to';
    return true;
  });

  const toGoCount = restaurants.filter((r) => r.status === 'to_go').length;
  const visitedCount = restaurants.filter((r) => r.status === 'went_to').length;

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
      
      <main className="container py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar */}
          <aside className="w-full lg:w-64 space-y-6">
            <div className="bg-card rounded-xl p-4 shadow-sm">
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center justify-center gap-1 text-2xl font-bold text-primary">
                    <Clock className="h-5 w-5" />
                    {toGoCount}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">To Go</p>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center justify-center gap-1 text-2xl font-bold text-primary">
                    <Check className="h-5 w-5" />
                    {visitedCount}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Been There</p>
                </div>
              </div>

              <FolderList
                folders={folders}
                selectedFolder={selectedFolder}
                onSelectFolder={setSelectedFolder}
                onFoldersChange={fetchFolders}
              />
            </div>
          </aside>

          {/* Main Content */}
          <div className="flex-1">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
              <h1 className="text-3xl font-bold">My Restaurants</h1>
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <RestaurantSearch
                  restaurants={restaurants}
                  onSelect={(r) => {
                    setSelectedFolder(r.folder_id || null);
                    setActiveTab(r.status === 'went_to' ? 'went_to' : 'to_go');
                  }}
                />
                <Button onClick={() => setAddDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add
                </Button>
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
              <TabsList>
                <TabsTrigger value="all">
                  All ({restaurants.length})
                </TabsTrigger>
                <TabsTrigger value="to_go">
                  <Clock className="h-4 w-4 mr-1" />
                  To Go ({toGoCount})
                </TabsTrigger>
                <TabsTrigger value="went_to">
                  <Check className="h-4 w-4 mr-1" />
                  Been There ({visitedCount})
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : filteredRestaurants.length === 0 ? (
              <div className="text-center py-12 bg-card rounded-xl">
                <MapPin className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium mb-2">No restaurants yet</h3>
                <p className="text-muted-foreground mb-4">
                  Start building your list of places to try!
                </p>
                <Button onClick={() => setAddDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Your First Restaurant
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filteredRestaurants.map((restaurant) => (
                  <RestaurantCard
                    key={restaurant.id}
                    restaurant={restaurant}
                    onMarkVisited={() => handleMarkVisited(restaurant.id)}
                    onDelete={() => handleDelete(restaurant.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      <AddRestaurantDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        folders={folders}
        onSuccess={fetchRestaurants}
      />

    </div>
  );
}
