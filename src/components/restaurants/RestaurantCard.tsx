import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapPin, Star, DollarSign, MoreHorizontal, Check, Clock, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSignedImageUrl } from '@/hooks/useSignedImageUrl';

interface RestaurantCardProps {
  restaurant: {
    id: string;
    name: string;
    address?: string | null;
    rating?: number | null;
    price_level?: number | null;
    status: string;
    notes?: string | null;
    folder?: { name: string; color: string } | null;
    images?: { image_url: string }[];
  };
  onEdit?: () => void;
  onDelete?: () => void;
  onMarkVisited?: () => void;
}

export function RestaurantCard({ restaurant, onEdit, onDelete, onMarkVisited }: RestaurantCardProps) {
  const firstImageUrl = restaurant.images?.[0]?.image_url;
  const { signedUrl: firstImage, loading: imageLoading } = useSignedImageUrl(firstImageUrl);

  return (
    <Card className="group overflow-hidden transition-all hover:shadow-lg">
      <div className="relative aspect-video bg-muted overflow-hidden">
        {imageLoading ? (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-accent/20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/50" />
          </div>
        ) : firstImage ? (
          <img
            src={firstImage}
            alt={restaurant.name}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-accent/20">
            <MapPin className="h-12 w-12 text-muted-foreground/50" />
          </div>
        )}
        {restaurant.folder && (
          <Badge
            className="absolute top-3 left-3"
            style={{ backgroundColor: restaurant.folder.color }}
          >
            {restaurant.folder.name}
          </Badge>
        )}
        <div className="absolute top-3 right-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {restaurant.status === 'to_go' && onMarkVisited && (
                <DropdownMenuItem onClick={onMarkVisited}>
                  <Check className="mr-2 h-4 w-4" />
                  Mark as Been There
                </DropdownMenuItem>
              )}
              {onEdit && (
                <DropdownMenuItem onClick={onEdit}>
                  Edit
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg truncate">{restaurant.name}</h3>
            {restaurant.address && (
              <p className="text-sm text-muted-foreground truncate flex items-center gap-1 mt-1">
                <MapPin className="h-3 w-3 flex-shrink-0" />
                {restaurant.address}
              </p>
            )}
          </div>
        <Badge variant={restaurant.status === 'went_to' ? 'default' : 'secondary'}>
            {restaurant.status === 'went_to' ? (
              <><Check className="h-3 w-3 mr-1" /> Been There</>
            ) : (
              <><Clock className="h-3 w-3 mr-1" /> To Go</>
            )}
          </Badge>
        </div>
        <div className="flex items-center gap-4 mt-3">
          {restaurant.rating != null && restaurant.rating > 0 && (
            <div className="flex items-center gap-1">
              {Array.from({ length: 5 }).map((_, i) => {
                const starValue = restaurant.rating! / 2;
                const filled = i < Math.floor(starValue);
                const half = !filled && i < starValue;
                return (
                  <div key={i} className="relative h-4 w-4">
                    <Star className="h-4 w-4 text-muted absolute inset-0" />
                    {filled && <Star className="h-4 w-4 text-yellow-500 fill-yellow-500 absolute inset-0" />}
                    {half && (
                      <div className="absolute inset-0 overflow-hidden" style={{ width: '50%' }}>
                        <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                      </div>
                    )}
                  </div>
                );
              })}
              <span className="text-xs text-muted-foreground ml-1">{restaurant.rating}/10</span>
            </div>
          )}
          {restaurant.price_level && (
            <div className="flex items-center">
              {Array.from({ length: 4 }).map((_, i) => (
                <DollarSign
                  key={i}
                  className={`h-4 w-4 -ml-1 first:ml-0 ${
                    i < restaurant.price_level! ? 'text-primary' : 'text-muted'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
        {restaurant.notes && (
          <p className="text-sm text-muted-foreground mt-3 line-clamp-2">{restaurant.notes}</p>
        )}
      </CardContent>
    </Card>
  );
}
