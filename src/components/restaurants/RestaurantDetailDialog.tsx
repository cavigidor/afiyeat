import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  MapPin,
  Star,
  DollarSign,
  Check,
  Clock,
  Edit,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { useSignedImageUrls } from '@/hooks/useSignedImageUrl';
import { getFolderIcon } from '@/lib/folderIcons';

export interface DetailRestaurant {
  id: string;
  name: string;
  address?: string | null;
  rating?: number | null;
  price_level?: number | null;
  status: string;
  notes?: string | null;
  folder?: { name: string; color: string } | null;
  images?: { image_url: string }[];
}

interface RestaurantDetailDialogProps {
  restaurant: DetailRestaurant | null;
  onOpenChange: (open: boolean) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onMarkVisited?: () => void;
}

export function RestaurantDetailDialog({
  restaurant,
  onOpenChange,
  onEdit,
  onDelete,
  onMarkVisited,
}: RestaurantDetailDialogProps) {
  const [imgIndex, setImgIndex] = useState(0);
  const imageUrls = restaurant?.images?.map((i) => i.image_url) || [];
  const { signedUrls, loading: imagesLoading } = useSignedImageUrls(imageUrls);
  const FallbackIcon = getFolderIcon(restaurant?.folder?.name);

  // Reset the carousel position each time a different place is opened.
  useEffect(() => {
    setImgIndex(0);
  }, [restaurant?.id]);

  if (!restaurant) return null;

  const validUrls = signedUrls.filter((u): u is string => !!u);
  const currentImage = validUrls[imgIndex];

  return (
    <Dialog open={!!restaurant} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap pr-6">
            {restaurant.name}
            <Badge variant={restaurant.status === 'went_to' ? 'default' : 'secondary'} className="gap-1">
              {restaurant.status === 'went_to' ? (
                <>
                  <Check className="h-3 w-3" /> Been There
                </>
              ) : (
                <>
                  <Clock className="h-3 w-3" /> To Go
                </>
              )}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
          {imagesLoading ? (
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/40" />
            </div>
          ) : currentImage ? (
            <>
              <img src={currentImage} alt={restaurant.name} className="w-full h-full object-cover" />
              {validUrls.length > 1 && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8"
                    aria-label="Previous photo"
                    onClick={() => setImgIndex((i) => (i - 1 + validUrls.length) % validUrls.length)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
                    aria-label="Next photo"
                    onClick={() => setImgIndex((i) => (i + 1) % validUrls.length)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                    {validUrls.map((_, i) => (
                      <div
                        key={i}
                        className={`h-1.5 w-1.5 rounded-full ${i === imgIndex ? 'bg-white' : 'bg-white/40'}`}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 via-secondary/20 to-accent/10">
              <FallbackIcon className="h-20 w-20 text-primary/70" strokeWidth={1.5} />
            </div>
          )}
        </div>

        <div className="space-y-3">
          {restaurant.address && (
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <MapPin className="h-4 w-4 flex-shrink-0" />
              {restaurant.address}
            </p>
          )}

          <div className="flex items-center gap-4 flex-wrap">
            {restaurant.folder && <Badge variant="outline">{restaurant.folder.name}</Badge>}
            {restaurant.rating != null && restaurant.rating > 0 && (
              <div className="flex items-center gap-1">
                <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                <span className="text-sm font-medium">{restaurant.rating}/10</span>
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

          {restaurant.notes && <p className="text-sm whitespace-pre-wrap">{restaurant.notes}</p>}

          {(onEdit || onDelete || onMarkVisited) && (
            <div className="flex flex-wrap gap-2 pt-3 border-t">
              {restaurant.status === 'to_go' && onMarkVisited && (
                <Button variant="outline" size="sm" onClick={onMarkVisited}>
                  <Check className="h-4 w-4 mr-1.5" />
                  Mark Visited
                </Button>
              )}
              {onEdit && (
                <Button variant="outline" size="sm" onClick={onEdit}>
                  <Edit className="h-4 w-4 mr-1.5" />
                  Edit
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={onDelete}
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Delete
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
