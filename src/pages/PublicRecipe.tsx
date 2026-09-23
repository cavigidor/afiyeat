import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock, Users, Thermometer, ChefHat } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { UserSafetyMenu } from '@/components/moderation/UserSafetyMenu';
import { ShareButton } from '@/components/sharing/ShareButton';
import { JoinAfiyeatCta, OwnerByline, SharedNotAvailable } from '@/components/sharing/SharedContentBits';
import { useSignedImageUrl } from '@/hooks/useSignedImageUrl';
import { SITE_URL } from '@/lib/site';
import { fetchRecipePreview, isUuid, ownerName, type RecipePreview } from '@/lib/sharedPreview';

/**
 * Signed-in viewers read through the recipes table, so RLS decides - that
 * also lets an owner open their own private recipe. Anyone else gets the
 * public preview, which only exists for recipes marked public.
 */
async function fetchRecipe(id: string, signedIn: boolean): Promise<RecipePreview | null> {
  if (!isUuid(id)) return null;

  if (signedIn) {
    const { data } = await supabase
      .from('recipes')
      .select(
        'id, title, description, prep_time_minutes, cook_time_minutes, servings, difficulty, cook_temp, cook_temp_unit, ingredients, instructions, tags, image_url, user_id',
      )
      .eq('id', id)
      .maybeSingle();
    if (data) {
      const { data: owner } = await supabase
        .from('profiles')
        .select('user_id, display_name, username, avatar_emoji, avatar_color')
        .eq('user_id', data.user_id)
        .maybeSingle();
      const { user_id, ...rest } = data;
      return {
        type: 'recipe',
        ...rest,
        owner: owner ?? {
          user_id,
          display_name: null,
          username: null,
          avatar_emoji: null,
          avatar_color: null,
        },
      };
    }
  }

  return fetchRecipePreview(id);
}

/**
 * /recipe/:id - one recipe, as seen through a shared link. Shows the whole
 * recipe, signed in or not: a public recipe is meant to be cooked, and
 * a recipe you can actually read is a better advert for the app than a
 * teaser behind a sign-up wall.
 */
export default function PublicRecipe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const { data: recipe, isLoading } = useQuery({
    queryKey: ['shared-recipe', id, !!user],
    queryFn: () => fetchRecipe(id!, !!user),
    enabled: !!id && !authLoading,
    staleTime: 60 * 1000,
  });

  const { signedUrl: image } = useSignedImageUrl(recipe?.image_url);
  const isOwner = !!user && recipe?.owner.user_id === user.id;
  const totalTime = (recipe?.prep_time_minutes ?? 0) + (recipe?.cook_time_minutes ?? 0);
  const ingredients = (recipe?.ingredients ?? []).filter((i) => i.trim());
  const steps = (recipe?.instructions ?? []).filter((s) => s.trim());

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container py-4 sm:py-8 px-4 sm:px-6 lg:px-8 max-w-2xl space-y-4">
        {isLoading || authLoading ? (
          <div className="space-y-4">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : !recipe ? (
          <SharedNotAvailable what="recipe" />
        ) : (
          <>
            <Card className="overflow-hidden">
              <div className="relative aspect-video bg-muted">
                {image ? (
                  <img src={image} alt={recipe.title} className="w-full h-full object-cover" decoding="async" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 via-secondary/20 to-accent/10">
                    <ChefHat className="h-20 w-20 text-primary/60" strokeWidth={1.5} />
                  </div>
                )}
                {recipe.difficulty && (
                  <Badge className="absolute top-3 right-3 capitalize">{recipe.difficulty}</Badge>
                )}
              </div>

              <CardContent className="p-5 space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h1 className="text-2xl font-bold leading-tight">{recipe.title}</h1>
                    {recipe.description && (
                      <p className="text-sm text-muted-foreground mt-1">{recipe.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {user && (
                      <ShareButton
                        url={`${SITE_URL}/recipe/${recipe.id}`}
                        source="recipe"
                        title={recipe.title}
                        text={
                          isOwner
                            ? `Here's my recipe for ${recipe.title} on Afiyeat`
                            : `${recipe.title} — found on Afiyeat`
                        }
                      />
                    )}
                    {user && !isOwner && (
                      <UserSafetyMenu
                        userId={recipe.owner.user_id}
                        displayName={ownerName(recipe.owner)}
                        contentType="recipe"
                        contentId={recipe.id}
                        onBlocked={() => navigate('/foodie', { replace: true })}
                      />
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  {totalTime > 0 && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-4 w-4" /> {totalTime} min
                    </span>
                  )}
                  {recipe.servings && (
                    <span className="flex items-center gap-1">
                      <Users className="h-4 w-4" /> {recipe.servings} servings
                    </span>
                  )}
                  {recipe.cook_temp && (
                    <span className="flex items-center gap-1">
                      <Thermometer className="h-4 w-4" /> {recipe.cook_temp}°{recipe.cook_temp_unit || 'F'}
                    </span>
                  )}
                </div>

                {ingredients.length > 0 && (
                  <section>
                    <h2 className="font-semibold mb-2">Ingredients</h2>
                    <ul className="space-y-1.5 text-sm">
                      {ingredients.map((ingredient, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                          <span>{ingredient}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {steps.length > 0 && (
                  <section>
                    <h2 className="font-semibold mb-2">Method</h2>
                    <ol className="space-y-3 text-sm">
                      {steps.map((step, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {i + 1}
                          </span>
                          <span className="pt-0.5">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}

                {recipe.tags && recipe.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {recipe.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="pt-3 border-t">
                  <OwnerByline owner={recipe.owner} verb="Recipe by" linkToProfile={!!user} />
                </div>
              </CardContent>
            </Card>

            {!user && <JoinAfiyeatCta owner={recipe.owner} what="this recipe" />}
          </>
        )}
      </main>
    </div>
  );
}
