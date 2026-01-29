import { Clock, Users, Thermometer, Trash2, ChefHat, Loader2 } from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useSignedImageUrl } from '@/hooks/useSignedImageUrl';
import type { Recipe } from '@/pages/Recipes';

interface RecipeCardProps {
  recipe: Recipe;
  isOwner: boolean;
  onDelete: () => void;
  onClick: () => void;
}

export function RecipeCard({ recipe, isOwner, onDelete, onClick }: RecipeCardProps) {
  const totalTime = (recipe.prep_time_minutes || 0) + (recipe.cook_time_minutes || 0);
  const { signedUrl: imageUrl, loading: imageLoading } = useSignedImageUrl(recipe.image_url);

  const getDifficultyColor = (difficulty: string | null) => {
    switch (difficulty) {
      case 'easy':
        return 'bg-green-500/10 text-green-600 dark:text-green-400';
      case 'medium':
        return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400';
      case 'hard':
        return 'bg-red-500/10 text-red-600 dark:text-red-400';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <Card
      className="overflow-hidden cursor-pointer hover:shadow-lg transition-shadow group"
      onClick={onClick}
    >
      <div className="relative aspect-video bg-muted">
        {imageLoading ? (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/30" />
          </div>
        ) : imageUrl ? (
          <img
            src={imageUrl}
            alt={recipe.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ChefHat className="h-12 w-12 text-muted-foreground/30" />
          </div>
        )}
        {recipe.difficulty && (
          <Badge
            className={`absolute top-2 right-2 ${getDifficultyColor(recipe.difficulty)}`}
          >
            {recipe.difficulty}
          </Badge>
        )}
      </div>

      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-lg line-clamp-1 group-hover:text-primary transition-colors">
            {recipe.title}
          </h3>
        </div>
        {recipe.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {recipe.description}
          </p>
        )}
      </CardHeader>

      <CardContent className="pb-2">
        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          {totalTime > 0 && (
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              <span>{totalTime} min</span>
            </div>
          )}
          {recipe.servings && (
            <div className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              <span>{recipe.servings} servings</span>
            </div>
          )}
          {recipe.cook_temp && (
            <div className="flex items-center gap-1">
              <Thermometer className="h-4 w-4" />
              <span>
                {recipe.cook_temp}°{recipe.cook_temp_unit || 'F'}
              </span>
            </div>
          )}
        </div>

        {recipe.tags && recipe.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {recipe.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {recipe.tags.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{recipe.tags.length - 3}
              </Badge>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter className="pt-2 border-t">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <Avatar className="h-6 w-6">
              <AvatarImage src={recipe.profile?.avatar_url || undefined} />
              <AvatarFallback>
                {(recipe.profile?.display_name || recipe.profile?.username || 'U')[0].toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm text-muted-foreground">
              {recipe.profile?.display_name || recipe.profile?.username || 'Anonymous'}
            </span>
          </div>

          {isOwner && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
