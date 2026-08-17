import { AnimalAvatar } from '@/components/shared/AnimalAvatar';

export interface AddedByInfo {
  label: string;
  avatarEmoji?: string | null;
  avatarColor?: string | null;
}

// Small "who added this" chip - only meaningful on Shared Lists (a single
// user's own My Restaurants/My Lists items don't need one), so it's an
// opt-in prop on RestaurantCard/RestaurantListRow rather than baked in.
export function AddedByBadge({ addedBy }: { addedBy: AddedByInfo }) {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
      <AnimalAvatar
        emoji={addedBy.avatarEmoji}
        color={addedBy.avatarColor}
        className="h-4 w-4"
        emojiClassName="text-[9px]"
      />
      <span className="truncate">{addedBy.label}</span>
    </div>
  );
}
