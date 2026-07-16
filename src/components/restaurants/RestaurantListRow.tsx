import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapPin, Star, DollarSign, MoreHorizontal, Check, Clock, Navigation } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface RestaurantRowData {
  id: string;
  name: string;
  address?: string | null;
  rating?: number | null;
  price_level?: number | null;
  status: string;
  folder?: { name: string; color: string } | null;
}

interface RestaurantListRowProps {
  restaurant: RestaurantRowData;
  onOpenDetail: () => void;
  onFlyTo?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onMarkVisited?: () => void;
}

export function RestaurantListRow({
  restaurant,
  onOpenDetail,
  onFlyTo,
  onEdit,
  onDelete,
  onMarkVisited,
}: RestaurantListRowProps) {
  const hasMenu = !!(onEdit || onDelete || onMarkVisited);

  return (
    <Card
      className="flex items-center gap-3 p-3 cursor-pointer hover:shadow-md hover:border-primary/40 transition-all"
      onClick={onOpenDetail}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpenDetail();
      }}
    >
      <div
        className="w-1.5 self-stretch rounded-full shrink-0"
        style={{ backgroundColor: restaurant.folder?.color || 'transparent' }}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-medium truncate">{restaurant.name}</h3>
          {restaurant.folder && (
            <Badge variant="secondary" className="text-xs shrink-0">
              {restaurant.folder.name}
            </Badge>
          )}
        </div>
        {restaurant.address && (
          <p className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
            <MapPin className="h-3 w-3 flex-shrink-0" />
            {restaurant.address}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {restaurant.rating != null && restaurant.rating > 0 && (
          <div className="hidden sm:flex items-center gap-1 text-sm">
            <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" />
            {restaurant.rating}/10
          </div>
        )}
        {restaurant.price_level && (
          <div className="hidden sm:flex items-center">
            {Array.from({ length: 4 }).map((_, i) => (
              <DollarSign
                key={i}
                className={`h-3.5 w-3.5 -ml-1 first:ml-0 ${
                  i < restaurant.price_level! ? 'text-primary' : 'text-muted'
                }`}
              />
            ))}
          </div>
        )}
        <Badge variant={restaurant.status === 'went_to' ? 'default' : 'secondary'} className="shrink-0 gap-1">
          {restaurant.status === 'went_to' ? <Check className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
          <span className="hidden sm:inline">{restaurant.status === 'went_to' ? 'Been There' : 'To Go'}</span>
        </Badge>

        {onFlyTo && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Show on map"
            onClick={(e) => {
              e.stopPropagation();
              onFlyTo();
            }}
          >
            <Navigation className="h-4 w-4" />
          </Button>
        )}

        {hasMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Restaurant options"
                className="h-8 w-8"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              {restaurant.status === 'to_go' && onMarkVisited && (
                <DropdownMenuItem onClick={onMarkVisited}>
                  <Check className="mr-2 h-4 w-4" />
                  Mark as Been There
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
        )}
      </div>
    </Card>
  );
}
