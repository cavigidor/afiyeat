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
import type { CustomList } from './CreateListDialog';
import type { CustomListItem } from './AddCustomListItemDialog';

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
              style={{ background: `linear-gradient(135deg, ${list.color}22, ${list.color}11)` }}
            >
              <span className="text-5xl">{list.icon}</span>
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
            <h3 className="font-semibold text-lg truncate">{item.name}</h3>
            {list.show_location && item.address && (
              <p className="text-sm text-muted-foreground truncate flex items-center gap-1 mt-1">
                <MapPin className="h-3 w-3 flex-shrink-0" />
                {item.address}
              </p>
            )}
          </div>
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
        {(list.value_field !== 'none') && (
          <div className="flex items-center gap-4 mt-3">
            {list.value_field === 'rating' && item.rating != null && (
              <div className="flex items-center gap-1">
                <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                <span className="text-sm">{item.rating}/10</span>
              </div>
            )}
            {list.value_field === 'price' && item.price_level && (
              <div className="flex items-center">
                {Array.from({ length: 4 }).map((_, i) => (
                  <DollarSign
                    key={i}
                    className={`h-4 w-4 -ml-1 first:ml-0 ${i < item.price_level! ? 'text-primary' : 'text-muted'}`}
                  />
                ))}
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
