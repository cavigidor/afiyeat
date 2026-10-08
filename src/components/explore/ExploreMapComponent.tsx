import { useMemo } from 'react';
import { useMapCenter } from '@/hooks/useMapCenter';
import { PlaceMap, type MapPoint } from '@/components/maps/PlaceMap';
import { formatCategory, toNumber, type ExplorePlace } from './ExplorePlaceCard';

interface ExploreMapComponentProps {
  places: ExplorePlace[];
  onSelectPlace: (place: ExplorePlace) => void;
  flyToMeRef: React.MutableRefObject<(() => void) | null>;
  onLocationDenied: () => void;
}

const PIN_PATH =
  'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z';

/** Explore's map of places people have been, on Apple Maps. */
export function ExploreMapComponent({ places, onSelectPlace, flyToMeRef, onLocationDenied }: ExploreMapComponentProps) {
  const { center } = useMapCenter(places);

  const points = useMemo<MapPoint[]>(
    () =>
      places.map((place) => {
        const avgRating = toNumber(place.avg_rating);
        const ratingCount = toNumber(place.rating_count) ?? 0;
        const category = formatCategory(place.category);
        return {
          id: place.place_id,
          name: place.name,
          address: place.address,
          latitude: place.latitude,
          longitude: place.longitude,
          details: [
            category ?? '',
            avgRating != null
              ? `${avgRating.toFixed(1)}/10 · ${ratingCount} rating${ratingCount === 1 ? '' : 's'}`
              : '',
          ].filter(Boolean),
          dot: { background: 'hsl(var(--primary))', svgPath: PIN_PATH },
        };
      }),
    [places],
  );

  const byId = useMemo(() => new Map(places.map((p) => [p.place_id, p])), [places]);

  return (
    <PlaceMap
      points={points}
      center={center}
      onSelect={(id) => {
        const place = byId.get(id);
        if (place) onSelectPlace(place);
      }}
      flyToMeRef={flyToMeRef}
      onLocationDenied={onLocationDenied}
    />
  );
}
