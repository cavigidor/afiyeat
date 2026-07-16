import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Star, DollarSign, Users } from 'lucide-react';

export interface ExplorePlace {
  place_id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  price_level: number | null;
  avg_rating: number | null;
  rating_count: number;
  contributor_count: number;
}

export function formatCategory(category: string | null): string | null {
  if (!category) return null;
  return category
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface ExplorePlaceCardProps {
  place: ExplorePlace;
  onClick?: () => void;
}

export function ExplorePlaceCard({ place, onClick }: ExplorePlaceCardProps) {
  const categoryLabel = formatCategory(place.category);

  return (
    <Card
      className="cursor-pointer transition-all hover:shadow-lg"
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg truncate">{place.name}</h3>
            {place.address && (
              <p className="text-sm text-muted-foreground truncate flex items-center gap-1 mt-1">
                <MapPin className="h-3 w-3 flex-shrink-0" />
                {place.address}
              </p>
            )}
          </div>
          {categoryLabel && (
            <Badge variant="secondary" className="shrink-0">
              {categoryLabel}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-4 mt-3 flex-wrap">
          {place.avg_rating != null && (
            <div className="flex items-center gap-1">
              <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
              <span className="text-sm font-medium">{place.avg_rating.toFixed(1)}/10</span>
              <span className="text-xs text-muted-foreground">
                ({place.rating_count} rating{place.rating_count === 1 ? '' : 's'})
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
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3 w-3" />
            {place.contributor_count} added this
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
