import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { getCurrentPosition } from '@/lib/native';
import { distanceMiles } from '@/lib/geo';
import type { TicketmasterEvent } from './EventCard';

interface EventsMapComponentProps {
  token: string;
  events: TicketmasterEvent[];
  center: { lat: number; lng: number };
  flyToMeRef: React.MutableRefObject<(() => void) | null>;
  // Fired when the user taps "Search this area" - hands back the map's
  // current center plus a radius sized to what's actually visible (bigger
  // when zoomed out, smaller when zoomed in), so results always roughly
  // match the viewport instead of always being a fixed 25mi around wherever
  // the device happened to be when the tab was first opened.
  onSearchThisArea: (center: { lat: number; lng: number }, radiusMiles: number) => void;
}

function formatEventDateShort(localDate: string | null): string {
  if (!localDate) return '';
  const [y, m, d] = localDate.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Sibling to ExploreMapComponent (restaurants) rather than a generalized
// shared map, matching how Friends.tsx/MyList.tsx/etc already each keep
// their own small map component instead of one do-everything map.
export function EventsMapComponent({ token, events, center, flyToMeRef, onSearchThisArea }: EventsMapComponentProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<globalThis.Map<string, any>>(new globalThis.Map());
  const [hasMoved, setHasMoved] = useState(false);
  // Center is only known once (device location resolves before this mounts,
  // per Explore.tsx gating events on eventsLocation) - captured once so a
  // later re-render with the "same" object identity doesn't re-pan.
  const initialCenterRef = useRef(center);
  // What the *results on screen* were actually searched for - updated after
  // every successful fetch (see the events effect below), not on every
  // render, so "has the map moved since that search" can be judged against
  // the right baseline.
  const lastSearchRef = useRef<{ lat: number; lng: number; zoom: number } | null>(null);

  useEffect(() => {
    if (!mapContainer.current || !token) return;
    let cancelled = false;

    const loadMapbox = async () => {
      const mapboxgl = (await import('mapbox-gl')).default;
      await import('mapbox-gl/dist/mapbox-gl.css');
      if (cancelled) return;

      mapboxgl.accessToken = token;

      mapRef.current = new mapboxgl.Map({
        container: mapContainer.current!,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [initialCenterRef.current.lng, initialCenterRef.current.lat],
        zoom: 11,
      });

      mapRef.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

      // Zoom changes fire 'moveend' too (not just panning), which is exactly
      // what we want - zooming out with no pan should still offer to widen
      // the search, not just a lat/lng change.
      mapRef.current.on('moveend', () => {
        if (!mapRef.current || !lastSearchRef.current) return;
        const c = mapRef.current.getCenter();
        const zoom = mapRef.current.getZoom();
        const moved = distanceMiles(lastSearchRef.current, { lat: c.lat, lng: c.lng }) > 0.5;
        const zoomed = Math.abs(zoom - lastSearchRef.current.zoom) > 0.6;
        setHasMoved(moved || zoomed);
      });

      flyToMeRef.current = () => {
        getCurrentPosition()
          .then((coords) => {
            mapRef.current?.flyTo({
              center: [coords.longitude, coords.latitude],
              zoom: 13,
              essential: true,
            });
          })
          .catch(() => {
            toast.error("Couldn't get your location. Check location permissions and try again.");
          });
      };
    };

    loadMapbox();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      flyToMeRef.current = null;
    };
  }, [token, flyToMeRef]);

  useEffect(() => {
    const eventsWithLocation = events.filter((e) => e.latitude != null && e.longitude != null);

    const loadMarkers = async () => {
      if (!mapRef.current) return;

      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();

      const mapboxgl = (await import('mapbox-gl')).default;

      if (eventsWithLocation.length > 0) {
        eventsWithLocation.forEach((event) => {
          try {
            const el = document.createElement('div');
            el.className =
              'flex items-center justify-center w-8 h-8 bg-indigo-500 rounded-full shadow-lg cursor-pointer hover:scale-110 transition-transform';
            el.innerHTML =
              '<svg class="w-4 h-4" fill="white" viewBox="0 0 24 24"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"/></svg>';

            const safeName = event.name.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const dateLabel = formatEventDateShort(event.localDate);
            const venueLine = event.venueName
              ? `<p class="text-xs text-gray-500">${event.venueName.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`
              : '';

            const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
              <div class="p-2">
                <h3 class="font-semibold">${safeName}</h3>
                ${dateLabel ? `<p class="text-sm">${dateLabel}</p>` : ''}
                ${venueLine}
                <a href="${event.url}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:#2563eb;text-decoration:none;display:inline-block;margin-top:6px;">Get Tickets</a>
              </div>
            `);

            const marker = new mapboxgl.Marker(el)
              .setLngLat([event.longitude!, event.latitude!])
              .setPopup(popup)
              .addTo(mapRef.current);

            markersRef.current.set(event.id, marker);
          } catch (err) {
            console.error('Failed to add Explore event marker:', event.id, err);
          }
        });

        const bounds = new mapboxgl.LngLatBounds();
        eventsWithLocation.forEach((e) => bounds.extend([e.longitude!, e.latitude!]));
        mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 14 });
      }

      // A fresh batch of results just rendered (whether or not any had
      // coordinates) - that's the new baseline "Search this area" compares
      // against, and fitBounds above may itself have just fired a moveend,
      // so clear the button now rather than let that stray event reopen it.
      const c = mapRef.current.getCenter();
      lastSearchRef.current = { lat: c.lat, lng: c.lng, zoom: mapRef.current.getZoom() };
      setHasMoved(false);
    };

    const checkMap = setInterval(() => {
      if (mapRef.current?.loaded()) {
        clearInterval(checkMap);
        loadMarkers();
      }
    }, 100);

    return () => clearInterval(checkMap);
  }, [events]);

  const handleSearchThisArea = () => {
    if (!mapRef.current) return;
    const c = mapRef.current.getCenter();
    const bounds = mapRef.current.getBounds();
    const ne = bounds.getNorthEast();
    const radiusMiles = Math.min(
      100,
      Math.max(2, Math.round(distanceMiles({ lat: c.lat, lng: c.lng }, { lat: ne.lat, lng: ne.lng }))),
    );
    setHasMoved(false);
    onSearchThisArea({ lat: c.lat, lng: c.lng }, radiusMiles);
  };

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />
      {hasMoved && (
        <button
          type="button"
          onClick={handleSearchThisArea}
          className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-full shadow-lg hover:bg-primary/90 transition-colors"
        >
          Search this area
        </button>
      )}
    </div>
  );
}
