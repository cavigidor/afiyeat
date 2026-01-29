import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Clock,
  Users,
  Thermometer,
  Trash2,
  ChefHat,
  Edit,
  Loader2,
} from 'lucide-react';
import type { Recipe } from '@/pages/Recipes';
import { useState } from 'react';
import { EditRecipeDialog } from './EditRecipeDialog';
import { useSignedImageUrl } from '@/hooks/useSignedImageUrl';

interface RecipeDetailDialogProps {
  recipe: Recipe | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isOwner: boolean;
  onDelete: () => void;
  onUpdate: () => void;
}

export function RecipeDetailDialog({
  recipe,
  open,
  onOpenChange,
  isOwner,
  onDelete,
  onUpdate,
}: RecipeDetailDialogProps) {
  const [editOpen, setEditOpen] = useState(false);
  const { signedUrl: imageUrl, loading: imageLoading } = useSignedImageUrl(recipe?.image_url);

  if (!recipe) return null;

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
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh]">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <DialogTitle className="text-2xl">{recipe.title}</DialogTitle>
              {isOwner && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setEditOpen(true)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={onDelete}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </DialogHeader>

          <ScrollArea className="max-h-[calc(90vh-120px)] pr-4">
            <div className="space-y-6">
              {/* Image */}
              <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
                {imageLoading ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <Loader2 className="h-12 w-12 animate-spin text-muted-foreground/30" />
                  </div>
                ) : imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={recipe.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ChefHat className="h-16 w-16 text-muted-foreground/30" />
                  </div>
                )}
              </div>

              {/* Author */}
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={recipe.profile?.avatar_url || undefined} />
                  <AvatarFallback>
                    {(recipe.profile?.display_name || recipe.profile?.username || 'U')[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium">
                    {recipe.profile?.display_name || recipe.profile?.username || 'Anonymous'}
                  </p>
                  <p className="text-sm text-muted-foreground">Recipe author</p>
                </div>
              </div>

              {/* Description */}
              {recipe.description && (
                <p className="text-muted-foreground">{recipe.description}</p>
              )}

              {/* Meta info */}
              <div className="flex flex-wrap gap-4">
                {recipe.difficulty && (
                  <Badge className={getDifficultyColor(recipe.difficulty)}>
                    {recipe.difficulty}
                  </Badge>
                )}
                {totalTime > 0 && (
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>
                      {recipe.prep_time_minutes && `${recipe.prep_time_minutes} min prep`}
                      {recipe.prep_time_minutes && recipe.cook_time_minutes && ' + '}
                      {recipe.cook_time_minutes && `${recipe.cook_time_minutes} min cook`}
                    </span>
                  </div>
                )}
                {recipe.servings && (
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Users className="h-4 w-4" />
                    <span>{recipe.servings} servings</span>
                  </div>
                )}
                {recipe.cook_temp && (
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Thermometer className="h-4 w-4" />
                    <span>
                      {recipe.cook_temp}°{recipe.cook_temp_unit || 'F'}
                    </span>
                  </div>
                )}
              </div>

              {/* Tags */}
              {recipe.tags && recipe.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {recipe.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Ingredients */}
              {recipe.ingredients.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-semibold text-lg">Ingredients</h3>
                  <ul className="space-y-2">
                    {recipe.ingredients.map((ingredient, index) => (
                      <li
                        key={index}
                        className="flex items-start gap-2 text-sm"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                        {ingredient}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Instructions */}
              {recipe.instructions.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-semibold text-lg">Instructions</h3>
                  <ol className="space-y-4">
                    {recipe.instructions.map((instruction, index) => (
                      <li key={index} className="flex gap-3">
                        <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex-shrink-0">
                          {index + 1}
                        </span>
                        <p className="text-sm pt-0.5">{instruction}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {isOwner && (
        <EditRecipeDialog
          recipe={recipe}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSuccess={() => {
            onUpdate();
            setEditOpen(false);
          }}
        />
      )}
    </>
  );
}
