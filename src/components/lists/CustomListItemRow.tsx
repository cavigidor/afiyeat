import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapPin, Star, DollarSign, MoreHorizontal, Check, Circle, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GetDirectionsButton } from '@/components/shared/GetDirectionsButton';
import type { CustomList } from './CreateListDialog';
import type { CustomListItem } from './AddCustomListItemDialog';

function formatPrice(item: CustomListItem, list: CustomList): string | null {
  if (!list.show_price) return null;
  if (list.price_mode === 'dollar') return item.price_level ? '$'.repeat(item.price_level) : null;
  return item.price_manual != null ? `$${item.price_manual}` : null;
}

function formatRating(item: CustomListItem, list: CustomList): string | null {
  if (!list.show_rating) return null;
  if (list.rating_mode === 'scale_10') return item.rating != null ? `${item.rating}/10` : null;
  if (list.rating_mode === 'stars_5') return item.rating != null ? `${item.rating}/5` : null;
  return item.rating_manual != null ? `${item.rating_manual}` : null;
}

interface CustomListItemRowProps {
  item: CustomListItem;
  list: CustomList;
  onOpenDetail: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onToggleStatus?: () => void;
  quickDelete?: boolean;
}

export function CustomListItemRow({
  item,
  list,
  onOpenDetail,
  onEdit,
  onDelete,
  onToggleStatus,
  quickDelete,
}: CustomListItemRowProps) {
  const isDone = item.status === 'done';
  const hasMenu = !!(onEdit || onDelete || onToggleStatus);

  return (
    <Card
      className="flex items-center gap-3 p-3 cursor-pointer hover:shadow-md hover:border-primary/40 transition-all"
      onClick={quickDelete ? undefined : onOpenDetail}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (!quickDelete && (e.key === 'Enter' || e.key === ' ')) onOpenDetail();
      }}
    >
      <div
        className="w-1.5 self-stretch rounded-full shrink-0"
        style={{ backgroundColor: item.type?.color || list.color }}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <h3 className="font-medium truncate">{item.name}</h3>
          {item.type && (
            <Badge variant="outline" className="gap-1 shrink-0 font-normal text-xs px-1.5 py-0">
              {item.type.icon && <span className="leading-none">{item.type.icon}</span>}
              {item.type.name}
            </Badge>
          )}
        </div>
        {list.show_location && item.address && (
          <p className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
            <MapPin className="h-3 w-3 flex-shrink-0" />
            {item.address}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {formatRating(item, list) && (
          <div className="hidden sm:flex items-center gap-1 text-sm">
            <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" />
            {formatRating(item, list)}
          </div>
        )}
        {list.show_price && list.price_mode === 'dollar' && item.price_level && (
          <div className="hidden sm:flex items-center">
            {Array.from({ length: 4 }).map((_, i) => (
              <DollarSign
                key={i}
                className={`h-3.5 w-3.5 -ml-1 first:ml-0 ${i < item.price_level! ? 'text-primary' : 'text-muted'}`}
              />
            ))}
          </div>
        )}
        {list.show_price && list.price_mode === 'manual' && formatPrice(item, list) && (
          <div className="hidden sm:flex items-center gap-1 text-sm">
            <DollarSign className="h-3.5 w-3.5 text-primary" />
            {formatPrice(item, list)}
          </div>
        )}
        <Badge variant={isDone ? 'default' : 'secondary'} className="shrink-0 gap-1">
          {isDone ? <Check className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
          <span className="hidden sm:inline">{isDone ? list.status_done_label : list.status_todo_label}</span>
        </Badge>

        {list.show_location && !quickDelete && (
          <GetDirectionsButton
            latitude={item.latitude}
            longitude={item.longitude}
            address={item.address}
            name={item.name}
            variant="ghost"
            iconOnly
            className="h-8 w-8"
          />
        )}

        {quickDelete ? (
          onDelete && (
            <Button
              variant="destructive"
              size="icon"
              aria-label="Delete item"
              className="h-8 w-8"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          )
        ) : (
          hasMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Item options"
                  className="h-8 w-8"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                {!isDone && onToggleStatus && (
                  <DropdownMenuItem onClick={onToggleStatus}>
                    <Check className="mr-2 h-4 w-4" />
                    Mark as {list.status_done_label}
                  </DropdownMenuItem>
                )}
                {onEdit && <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>}
                {onDelete && (
                  <DropdownMenuItem onClick={onDelete} className="text-destructive">
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        )}
      </div>
    </Card>
  );
}
