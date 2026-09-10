import { Skeleton } from '@/components/ui/skeleton';

/**
 * Placeholder for a single card in the same shape as RestaurantCard /
 * RecipeCard / CustomListItemCard / EventCard (aspect-video image area,
 * title line, one shorter meta line) - so the loading state doesn't jump
 * around once real cards swap in.
 */
function CardSkeleton() {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="p-4 space-y-2">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

/**
 * A grid of card skeletons standing in for a list of restaurant/recipe/
 * event/custom-list-item cards while the first page load's data is still in
 * flight. Used instead of a bare spinner so the stable page layout (grid,
 * card outlines) is visible immediately and content pops in progressively
 * rather than the screen going from blank/spinner straight to fully loaded.
 */
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}
