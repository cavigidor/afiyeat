import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Loader2, MapPin, Star, DollarSign } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatCategory, toNumber, type ExplorePlace } from './ExplorePlaceCard';

interface PlaceComment {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  rating: number | null;
  notes: string | null;
  created_at: string;
}

async function fetchPlaceComments(placeId: string, mode: 'friends' | 'all'): Promise<PlaceComment[]> {
  const { data, error } = await supabase.rpc('get_place_comments', {
    p_place_id: placeId,
    p_mode: mode,
  });
  if (error) throw error;
  return data || [];
}

interface PlaceDetailSheetProps {
  place: ExplorePlace | null;
  mode: 'friends' | 'all';
  onOpenChange: (open: boolean) => void;
}

export function PlaceDetailSheet({ place, mode, onOpenChange }: PlaceDetailSheetProps) {
  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['place-comments', place?.place_id, mode],
    queryFn: () => fetchPlaceComments(place!.place_id, mode),
    enabled: !!place,
  });

  const categoryLabel = place ? formatCategory(place.category) : null;
  const avgRating = place ? toNumber(place.avg_rating) : null;
  const ratingCount = place ? toNumber(place.rating_count) ?? 0 : 0;

  return (
    <Sheet open={!!place} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
        {place && (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="flex items-center gap-2 flex-wrap">
                {place.name}
                {categoryLabel && <Badge variant="secondary">{categoryLabel}</Badge>}
              </SheetTitle>
            </SheetHeader>

            {place.address && (
              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                <MapPin className="h-3 w-3 flex-shrink-0" />
                {place.address}
              </p>
            )}

            <div className="flex items-center gap-4 mt-3">
              {avgRating != null && (
                <div className="flex items-center gap-1">
                  <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                  <span className="text-sm font-medium">{avgRating.toFixed(1)}/10</span>
                  <span className="text-xs text-muted-foreground">
                    ({ratingCount} rating{ratingCount === 1 ? '' : 's'})
                  </span>
                </div>
              )}
              {place.price_level && (
                <div className="flex items-center">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <DollarSign
                      key={i}
                      className={`h-4 w-4 -ml-1 first:ml-0 ${
                        i < place.price_level! ? 'text-primary' : 'text-muted'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground">
                Comments {comments.length > 0 && `(${comments.length})`}
              </h4>

              {isLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : comments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No comments visible for this place yet.
                </p>
              ) : (
                comments.map((c) => (
                  <div key={c.user_id} className="flex gap-3 p-3 rounded-lg bg-muted/40">
                    <Link to={`/u/${c.user_id}`} onClick={() => onOpenChange(false)}>
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={c.avatar_url || ''} />
                        <AvatarFallback className="bg-primary text-primary-foreground">
                          {(c.username || c.display_name || 'U')[0].toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </Link>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          to={`/u/${c.user_id}`}
                          onClick={() => onOpenChange(false)}
                          className="font-medium text-sm hover:underline"
                        >
                          {c.display_name || c.username || 'Someone'}
                        </Link>
                        {c.rating != null && (
                          <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                            <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                            {c.rating}/10
                          </span>
                        )}
                      </div>
                      {c.notes && <p className="text-sm mt-1 whitespace-pre-wrap">{c.notes}</p>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
