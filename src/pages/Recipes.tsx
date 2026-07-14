import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Plus, Search, ChefHat, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RecipeCard } from '@/components/recipes/RecipeCard';
import { AddRecipeDialog } from '@/components/recipes/AddRecipeDialog';
import { RecipeDetailDialog } from '@/components/recipes/RecipeDetailDialog';
import { toast } from 'sonner';

export interface Recipe {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  servings: number | null;
  cook_temp: number | null;
  cook_temp_unit: string | null;
  difficulty: string | null;
  ingredients: string[];
  instructions: string[];
  tags: string[] | null;
  image_url: string | null;
  is_public: boolean;
  created_at: string;
  profile?: {
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
  } | null;
}

async function fetchRecipesFor(userId: string, activeTab: string): Promise<Recipe[]> {
  let query = supabase
    .from('recipes')
    .select('*')
    .order('created_at', { ascending: false });

  if (activeTab === 'my-recipes') {
    query = query.eq('user_id', userId);
  } else {
    query = query.eq('is_public', true);
  }

  const { data, error } = await query;
  if (error) throw error;

  // Fetch profiles for each recipe
  const recipesWithProfiles = await Promise.all(
    (data || []).map(async (recipe) => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, username, avatar_url')
        .eq('user_id', recipe.user_id)
        .maybeSingle();

      return {
        ...recipe,
        ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
        instructions: Array.isArray(recipe.instructions) ? recipe.instructions : [],
        profile,
      } as Recipe;
    }),
  );

  return recipesWithProfiles;
}

export default function Recipes() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('discover');
  const [searchQuery, setSearchQuery] = useState('');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanInitialData, setScanInitialData] = useState<any>(null);

  const handleScanRecipe = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error('Image must be under 8MB');
      return;
    }
    setScanning(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1] || '');
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const { data, error } = await supabase.functions.invoke('parse-recipe-image', {
        body: { imageBase64: base64, mimeType: file.type },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setScanInitialData(data?.recipe || {});
      setAddDialogOpen(true);
      toast.success('Recipe extracted! Review and fill in any missing details.');
    } catch (err: any) {
      console.error('Scan recipe failed:', err);
      toast.error(err?.message || 'Failed to extract recipe');
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  const {
    data: recipes = [],
    isLoading: loading,
  } = useQuery({
    queryKey: ['recipes', user?.id, activeTab],
    queryFn: () => fetchRecipesFor(user!.id, activeTab),
    enabled: !!user,
  });

  const invalidateRecipes = () =>
    queryClient.invalidateQueries({ queryKey: ['recipes', user?.id] });

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('recipes').delete().eq('id', id);
    if (error) {
      toast.error('Failed to delete recipe');
    } else {
      toast.success('Recipe deleted');
      invalidateRecipes();
    }
  };

  const filteredRecipes = recipes.filter((recipe) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      recipe.title.toLowerCase().includes(query) ||
      recipe.description?.toLowerCase().includes(query) ||
      recipe.tags?.some((tag) => tag.toLowerCase().includes(query)) ||
      recipe.ingredients.some((ing) => ing.toLowerCase().includes(query))
    );
  });

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

      <main className="container py-4 sm:py-8 px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold">Recipes</h1>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search recipes, ingredients..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button variant="outline" asChild disabled={scanning}>
              <label className="cursor-pointer">
                {scanning ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ScanLine className="h-4 w-4 mr-2" />
                )}
                {scanning ? 'Scanning…' : 'Scan Recipe'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleScanRecipe}
                  disabled={scanning}
                />
              </label>
            </Button>
            <Button onClick={() => { setScanInitialData(null); setAddDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              Add Recipe
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
          <TabsList>
            <TabsTrigger value="discover">Discover</TabsTrigger>
            <TabsTrigger value="my-recipes">My Recipes</TabsTrigger>
          </TabsList>
        </Tabs>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredRecipes.length === 0 ? (
          <div className="text-center py-12 bg-card rounded-xl">
            <ChefHat className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-2">
              {activeTab === 'my-recipes' ? 'No recipes yet' : 'No recipes found'}
            </h3>
            <p className="text-muted-foreground mb-4">
              {activeTab === 'my-recipes'
                ? 'Start adding your favorite recipes!'
                : 'Try a different search term'}
            </p>
            {activeTab === 'my-recipes' && (
              <Button onClick={() => setAddDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Recipe
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-6">
            {filteredRecipes.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                isOwner={recipe.user_id === user?.id}
                onDelete={() => handleDelete(recipe.id)}
                onClick={() => setSelectedRecipe(recipe)}
              />
            ))}
          </div>
        )}
      </main>

      <AddRecipeDialog
        open={addDialogOpen}
        onOpenChange={(open) => {
          setAddDialogOpen(open);
          if (!open) setScanInitialData(null);
        }}
        onSuccess={invalidateRecipes}
        initialData={scanInitialData}
      />

      <RecipeDetailDialog
        recipe={selectedRecipe}
        open={!!selectedRecipe}
        onOpenChange={(open) => !open && setSelectedRecipe(null)}
        isOwner={selectedRecipe?.user_id === user?.id}
        onDelete={() => {
          if (selectedRecipe) {
            handleDelete(selectedRecipe.id);
            setSelectedRecipe(null);
          }
        }}
        onUpdate={invalidateRecipes}
      />
    </div>
  );
}
