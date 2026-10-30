import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { AnimalAvatar } from '@/components/shared/AnimalAvatar';
import { ListChecks, EyeOff } from 'lucide-react';
import { communityListPath } from '@/lib/communityLists';

/**
 * A community list as get_explore_lists returns it. Identified lists carry
 * their id and owner; anonymous lists carry only a discovery token - the
 * server never sends their id or anything about who made them.
 */
export interface ExploreList {
  list_id: string | null;
  list_name: string;
  list_icon: string | null;
  item_count: number | string | null;
  user_id: string | null;
  username: string | null;
  display_name: string | null;
  avatar_emoji: string | null;
  avatar_color: string | null;
  is_anonymous: boolean;
  discovery_token?: string | null;
}

function toCount(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

interface ExploreListCardProps {
  list: ExploreList;
}

// Each row is one account's own list, so the contributor is shown on the
// card. Tapping the card opens the list; tapping the contributor opens
// their profile (own handler + stopPropagation, since a Link can't nest in
// a Link). An anonymous list opens its anonymous view, and its card says
// plainly that nobody's name is attached - there's no profile to open.
export function ExploreListCard({ list }: ExploreListCardProps) {
  const navigate = useNavigate();
  const itemCount = toCount(list.item_count);
  const path = communityListPath(list);
  const nameLabel = list.display_name || list.username || 'Afiyeat member';

  return (
    <Card
      interactive={!!path}
      className="overflow-hidden hover:shadow-md transition-shadow"
      onClick={path ? () => navigate(path) : undefined}
      role={path ? 'link' : undefined}
      aria-label={path ? `${list.list_name}, ${list.is_anonymous ? 'anonymous list' : `by ${nameLabel}`}` : undefined}
      tabIndex={path ? 0 : undefined}
      onKeyDown={path ? (e) => e.key === 'Enter' && navigate(path) : undefined}
    >
      <CardContent className="p-4 flex items-center gap-3">
        <div className="w-11 h-11 rounded-lg flex items-center justify-center text-xl shrink-0 bg-muted">
          {list.list_icon || <ListChecks className="h-5 w-5 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate">{list.list_name}</p>
          <p className="text-xs text-muted-foreground">
            {itemCount} item{itemCount === 1 ? '' : 's'}
          </p>
        </div>
        {list.is_anonymous ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            <EyeOff className="h-3.5 w-3.5" />
            Anonymous
          </span>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (list.user_id) navigate(`/u/${list.user_id}`);
            }}
            className="flex items-center gap-2 shrink-0 rounded-full hover:underline"
          >
            <AnimalAvatar
              emoji={list.avatar_emoji}
              color={list.avatar_color}
              className="h-7 w-7"
              emojiClassName="text-xs"
            />
            <span className="text-sm max-w-[100px] truncate">{nameLabel}</span>
          </button>
        )}
      </CardContent>
    </Card>
  );
}
