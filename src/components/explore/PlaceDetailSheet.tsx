import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Loader2, MapPin, Star, DollarSign } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatCategory, toNumber, type ExplorePlace } from './ExplorePlaceCard';
import { GetDirectionsButton } from '@/components/shared/GetDirectionsButton';

interface PlaceComment {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  rating: number | null;
  notes: string | null;
  created_at: string;
  is_anonymous: boolean;
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
  // Radix keeps SheetContent mounted during its closing animation, and the
  // parent nulls `place` the instant a close is requested. Without holding
  // onto the last non-null place, SheetTitle would unmount mid-animation
  // while SheetContent is still in the DOM, which trips Radix's "DialogContent
  // requires a DialogTitle" accessibility warning. Holding the last value
  // also avoids a content-flash-to-empty during the close animation.
  const [displayPlace, setDisplayPlace] = useState<ExplorePlace | null>(null);
  useEffect(() => {
    if (place) setDisplayPlace(place);
  }, [place]);

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['place-comments', displayPlace?.place_id, mode],
    queryFn: () => fetchPlaceComments(displayPlace!.place_id, mode),
    enabled: !!place,
  });

  const categoryLabel = displayPlace ? formatCategory(displayPlace.category) : null;
  const avgRating = displayPlace ? toNumber(displayPlace.avg_rating) : null;
  const ratingCount = displayPlace ? toNumber(displayPlace.rating_count) ?? 0 : 0;

  return (
    <Sheet open={!!place} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
        {displayPlace && (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="flex items-center gap-2 flex-wrap">
                {displayPlace.name}
                {categoryLabel && <Badge variant="secondary">{categoryLabel}</Badge>}
              </SheetTitle>
            </SheetHeader>

            {displayPlace.address && (
              <div className="flex items-center justify-between gap-2 flex-wrap mt-1">
                <p className="text-sm text-muted-foreground flex items-center gap-1 min-w-0">
                  <MapPin className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{displayPlace.address}</span>
                </p>
                <GetDirectionsButton
                  latitude={displayPlace.latitude}
                  longitude={displayPlace.longitude}
                  address={displayPlace.address}
                  name={displayPlace.name}
                  size="sm"
                />
              </div>
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
              {displayPlace.price_level && (
                <div className="flex items-center">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <DollarSign
                      key={i}
                      className={`h-4 w-4 -ml-1 first:ml-0 ${
                        i < displayPlace.price_level! ? 'text-primary' : 'text-muted'
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
                comments.map((c) => {
                  // Private contributors show up (per-place rating/notes still
                  // count), but their identity is withheld - the RPC already
                  // nulled username/display_name/avatar_url for them, and
                  // is_anonymous tells us not to link through to their
                  // profile page either (that page shows the real username,
                  // which would defeat the anonymization above).
                  const avatarInitial = (c.username || c.display_name || 'U')[0].toUpperCase();
                  const nameLabel = c.display_name || c.username || 'Someone';

                  const avatar = (
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={c.avatar_url || ''} />
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {avatarInitial}
                      </AvatarFallback>
                    </Avatar>
                  );

                  return (
                    <div key={c.user_id} className="flex gap-3 p-3 rounded-lg bg-muted/40">
                      {c.is_anonymous ? (
                        avatar
                      ) : (
                        <Link to={`/u/${c.user_id}`} onClick={() => onOpenChange(false)}>
                          {avatar}
                        </Link>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {c.is_anonymous ? (
                            <span className="font-medium text-sm text-muted-foreground">{nameLabel}</span>
                          ) : (
                            <Link
                              to={`/u/${c.user_id}`}
                              onClick={() => onOpenChange(false)}
                              className="font-medium text-sm hover:underline"
                            >
                              {nameLabel}
                            </Link>
                          )}
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
                  );
                })
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
