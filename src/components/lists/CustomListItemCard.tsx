import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapPin, Star, DollarSign, MoreHorizontal, Check, Circle, Loader2, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSignedImageUrl } from '@/hooks/useSignedImageUrl';
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

interface CustomListItemCardProps {
  item: CustomListItem;
  list: CustomList;
  onEdit?: () => void;
  onDelete?: () => void;
  onToggleStatus?: () => void;
  quickDelete?: boolean;
}

export function CustomListItemCard({ item, list, onEdit, onDelete, onToggleStatus, quickDelete }: CustomListItemCardProps) {
  const isDone = item.status === 'done';
  const firstImageUrl = item.images?.[0]?.image_url;
  const { signedUrl: firstImage, loading: imageLoading } = useSignedImageUrl(firstImageUrl);
  const [imgFailed, setImgFailed] = useState(false);
  const showFallback = !firstImage || imgFailed;
  const showImageArea = list.show_photos;

  return (
    <Card className="group overflow-hidden transition-all hover:shadow-lg">
      {showImageArea && (
        <div className="relative aspect-video bg-muted overflow-hidden">
          {imageLoading ? (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-accent/10">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/50" />
            </div>
          ) : !showFallback ? (
            <img
              src={firstImage}
              alt={item.name}
              onError={() => setImgFailed(true)}
              className="w-full h-full object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${item.type?.color || list.color}22, ${item.type?.color || list.color}11)`,
              }}
            >
              <span className="text-5xl">{item.type?.icon || list.icon}</span>
            </div>
          )}
          <div className="absolute top-3 right-3">
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="Item options"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
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
            )}
          </div>
        </div>
      )}
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <h3 className="font-semibold text-lg truncate">{item.name}</h3>
              {item.type && (
                <Badge variant="outline" className="gap-1 shrink-0 font-normal text-xs px-1.5 py-0">
                  {item.type.icon && <span className="leading-none">{item.type.icon}</span>}
                  {item.type.name}
                </Badge>
              )}
            </div>
            {list.show_location && item.address && (
              <p className="text-sm text-muted-foreground truncate flex items-center gap-1 mt-1">
                <MapPin className="h-3 w-3 flex-shrink-0" />
                {item.address}
              </p>
            )}
          </div>
          {list.show_location && (
            <GetDirectionsButton
              latitude={item.latitude}
              longitude={item.longitude}
              address={item.address}
              name={item.name}
              variant="ghost"
              iconOnly
              className="h-8 w-8 shrink-0"
            />
          )}
          {!showImageArea ? (
            quickDelete ? (
              onDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive shrink-0"
                  aria-label="Delete item"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              )
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Item options" className="h-8 w-8 shrink-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
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
          ) : null}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Badge variant={isDone ? 'default' : 'secondary'}>
            {isDone ? (
              <><Check className="h-3 w-3 mr-1" /> {list.status_done_label}</>
            ) : (
              <><Circle className="h-3 w-3 mr-1" /> {list.status_todo_label}</>
            )}
          </Badge>
        </div>
        {(list.show_price || list.show_rating) && (
          <div className="flex items-center gap-4 mt-3">
            {formatRating(item, list) && (
              <div className="flex items-center gap-1">
                <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                <span className="text-sm">{formatRating(item, list)}</span>
              </div>
            )}
            {list.show_price && list.price_mode === 'dollar' && item.price_level && (
              <div className="flex items-center">
                {Array.from({ length: 4 }).map((_, i) => (
                  <DollarSign
                    key={i}
                    className={`h-4 w-4 -ml-1 first:ml-0 ${i < item.price_level! ? 'text-primary' : 'text-muted'}`}
                  />
                ))}
              </div>
            )}
            {list.show_price && list.price_mode === 'manual' && formatPrice(item, list) && (
              <div className="flex items-center gap-1">
                <DollarSign className="h-4 w-4 text-primary" />
                <span className="text-sm">{formatPrice(item, list)}</span>
              </div>
            )}
          </div>
        )}
        {list.show_notes && item.notes && (
          <p className="text-sm text-muted-foreground mt-3 line-clamp-2">{item.notes}</p>
        )}
      </CardContent>
    </Card>
  );
}
