import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { getCurrentPosition } from '@/lib/native';
import type { TicketmasterEvent } from './EventCard';

interface EventsMapComponentProps {
  token: string;
  events: TicketmasterEvent[];
  center: { lat: number; lng: number };
  flyToMeRef: React.MutableRefObject<(() => void) | null>;
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
export function EventsMapComponent({ token, events, center, flyToMeRef }: EventsMapComponentProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<globalThis.Map<string, any>>(new globalThis.Map());
  // Center is only known once (device location resolves before this mounts,
  // per Explore.tsx gating events on eventsLocation) - captured once so a
  // later re-render with the "same" object identity doesn't re-pan.
  const initialCenterRef = useRef(center);

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

      if (eventsWithLocation.length === 0) return;

      const mapboxgl = (await import('mapbox-gl')).default;

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
    };

    const checkMap = setInterval(() => {
      if (mapRef.current?.loaded()) {
        clearInterval(checkMap);
        loadMarkers();
      }
    }, 100);

    return () => clearInterval(checkMap);
  }, [events]);

  return <div ref={mapContainer} className="w-full h-full" />;
}
