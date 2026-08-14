import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export interface AddedByInfo {
  label: string;
  avatarUrl?: string | null;
}

// Small "who added this" chip - only meaningful on Shared Lists (a single
// user's own My Restaurants/My Lists items don't need one), so it's an
// opt-in prop on RestaurantCard/RestaurantListRow rather than baked in.
export function AddedByBadge({ addedBy }: { addedBy: AddedByInfo }) {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
      <Avatar className="h-4 w-4 shrink-0">
        <AvatarImage src={addedBy.avatarUrl || ''} />
        <AvatarFallback className="text-[9px] bg-muted-foreground/20">
          {addedBy.label[0]?.toUpperCase() || '?'}
        </AvatarFallback>
      </Avatar>
      <span className="truncate">{addedBy.label}</span>
    </div>
  );
}
