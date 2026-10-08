import { useEffect, useMemo, useRef, useState } from 'react';
import { distanceMiles } from '@/lib/geo';
import { PlaceMap, type MapPoint, type MapViewport } from '@/components/maps/PlaceMap';
import type { TicketmasterEvent } from './EventCard';

interface EventsMapComponentProps {
  events: TicketmasterEvent[];
  center: { lat: number; lng: number };
  flyToMeRef: React.MutableRefObject<(() => void) | null>;
  // Fired when the user taps "Search this area" - hands back the map's
  // current center plus a radius sized to what's actually visible (bigger
  // when zoomed out, smaller when zoomed in), so results roughly match the
  // viewport instead of a fixed 25mi around wherever the device was.
  onSearchThisArea: (center: { lat: number; lng: number }, radiusMiles: number) => void;
  onLocationDenied: () => void;
}

const CALENDAR_PATH =
  'M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z';

function formatEventDateShort(localDate: string | null): string {
  if (!localDate) return '';
  const [y, m, d] = localDate.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// The map frames a fresh batch of results itself; moves within this window
// after new results arrive are the map's own, not the user's.
const PROGRAMMATIC_MOVE_MS = 1200;

/** Explore's events map, on Apple Maps. */
export function EventsMapComponent({ events, center, flyToMeRef, onSearchThisArea, onLocationDenied }: EventsMapComponentProps) {
  const [hasMoved, setHasMoved] = useState(false);
  const viewport = useRef<MapViewport | null>(null);
  const resultsAt = useRef(Date.now());

  useEffect(() => {
    resultsAt.current = Date.now();
    setHasMoved(false);
  }, [events]);

  const points = useMemo<MapPoint[]>(
    () =>
      events.map((event) => ({
        id: event.id,
        name: event.name,
        latitude: event.latitude,
        longitude: event.longitude,
        details: [formatEventDateShort(event.localDate), event.venueName ?? ''].filter(Boolean),
        link: event.url ? { url: event.url, label: 'Get Tickets' } : undefined,
        directions: false,
        dot: { background: '#6366f1', svgPath: CALENDAR_PATH },
      })),
    [events],
  );

  const handleSearchThisArea = () => {
    const v = viewport.current;
    if (!v) return;
    const radiusMiles = Math.min(100, Math.max(2, Math.round(distanceMiles(v.center, v.northEast))));
    setHasMoved(false);
    onSearchThisArea(v.center, radiusMiles);
  };

  return (
    <PlaceMap
      points={points}
      center={center}
      flyToMeRef={flyToMeRef}
      onLocationDenied={onLocationDenied}
      onViewportChange={(v) => {
        viewport.current = v;
        if (Date.now() - resultsAt.current > PROGRAMMATIC_MOVE_MS) setHasMoved(true);
      }}
    >
      {hasMoved && (
        <button
          type="button"
          onClick={handleSearchThisArea}
          className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-full shadow-lg hover:bg-primary/90 transition-colors"
        >
          Search this area
        </button>
      )}
    </PlaceMap>
  );
}
