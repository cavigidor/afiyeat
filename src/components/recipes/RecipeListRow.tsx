import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Clock, Users, Trash2 } from 'lucide-react';
import type { Recipe } from '@/pages/Recipes';

interface RecipeListRowProps {
  recipe: Recipe;
  isOwner: boolean;
  onDelete: () => void;
  onClick: () => void;
}

export function RecipeListRow({ recipe, isOwner, onDelete, onClick }: RecipeListRowProps) {
  const totalTime = (recipe.prep_time_minutes || 0) + (recipe.cook_time_minutes || 0);

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
      className="flex items-center gap-3 p-3 cursor-pointer hover:shadow-md hover:border-primary/40 transition-all"
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-medium truncate">{recipe.title}</h3>
          {recipe.difficulty && (
            <Badge className={`text-xs shrink-0 ${getDifficultyColor(recipe.difficulty)}`}>
              {recipe.difficulty}
            </Badge>
          )}
        </div>
        {recipe.description && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{recipe.description}</p>
        )}
      </div>

      <div className="hidden sm:flex items-center gap-3 text-sm text-muted-foreground shrink-0">
        {totalTime > 0 && (
          <div className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {totalTime} min
          </div>
        )}
        {recipe.servings && (
          <div className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {recipe.servings}
          </div>
        )}
      </div>

      <Avatar className="h-7 w-7 shrink-0">
        <AvatarImage src={recipe.profile?.avatar_url || undefined} />
        <AvatarFallback className="text-xs">
          {(recipe.profile?.display_name || recipe.profile?.username || 'U')[0].toUpperCase()}
        </AvatarFallback>
      </Avatar>

      {isOwner && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive shrink-0"
          aria-label="Delete recipe"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </Card>
  );
}
