import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ListChecks } from 'lucide-react';

export interface ExploreList {
  list_id: string;
  list_name: string;
  list_icon: string | null;
  item_count: number | string | null;
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_anonymous: boolean;
}

function toCount(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

interface ExploreListCardProps {
  list: ExploreList;
}

// Unlike restaurant places (merged across contributors into one card),
// each row here is one account's own list - so the contributor is shown
// directly on the card rather than tucked into a detail sheet. Clicking
// the card body opens the list; clicking the contributor row opens their
// profile instead (own click handler + stopPropagation, since a Link
// can't nest inside another Link). A private account's list still shows
// up (same "All Nearby" convention as restaurants), but with its
// identity withheld and nothing on the card clickable at all - the list
// itself isn't actually viewable by a non-follower (RLS blocks it), so
// there's nowhere useful to send the click.
export function ExploreListCard({ list }: ExploreListCardProps) {
  const navigate = useNavigate();
  const itemCount = toCount(list.item_count);
  const nameLabel = list.display_name || list.username || 'Anonymous';
  const avatarInitial = (list.username || list.display_name || 'A')[0].toUpperCase();

  return (
    <Card
      className={`overflow-hidden transition-shadow ${
        list.is_anonymous ? 'opacity-90' : 'cursor-pointer hover:shadow-md'
      }`}
      onClick={list.is_anonymous ? undefined : () => navigate(`/u/${list.user_id}/lists/${list.list_id}`)}
      role={list.is_anonymous ? undefined : 'button'}
      tabIndex={list.is_anonymous ? undefined : 0}
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
        <button
          type="button"
          disabled={list.is_anonymous}
          onClick={(e) => {
            if (list.is_anonymous) return;
            e.stopPropagation();
            navigate(`/u/${list.user_id}`);
          }}
          className={`flex items-center gap-2 shrink-0 rounded-full ${
            list.is_anonymous ? 'cursor-default' : 'hover:underline'
          }`}
        >
          <Avatar className="h-7 w-7">
            <AvatarImage src={list.avatar_url || ''} />
            <AvatarFallback className="bg-primary text-primary-foreground text-xs">
              {list.is_anonymous ? 'A' : avatarInitial}
            </AvatarFallback>
          </Avatar>
          <span className={`text-sm max-w-[100px] truncate ${list.is_anonymous ? 'text-muted-foreground' : ''}`}>
            {list.is_anonymous ? 'Anonymous' : nameLabel}
          </span>
        </button>
      </CardContent>
    </Card>
  );
}
