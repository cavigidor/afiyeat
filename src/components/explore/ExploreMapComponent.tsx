import { useEffect, useRef } from 'react';
import { useMapCenter } from '@/hooks/useMapCenter';
import { formatCategory, toNumber, type ExplorePlace } from './ExplorePlaceCard';

interface ExploreMapComponentProps {
  token: string;
  places: ExplorePlace[];
  onSelectPlace: (place: ExplorePlace) => void;
}

export function ExploreMapComponent({ token, places, onSelectPlace }: ExploreMapComponentProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<globalThis.Map<string, any>>(new globalThis.Map());
  const onSelectPlaceRef = useRef(onSelectPlace);
  onSelectPlaceRef.current = onSelectPlace;

  const mapCenterInput = places
    .filter((p) => p.latitude != null && p.longitude != null)
    .map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
  const { center } = useMapCenter(mapCenterInput);
  // Created once per token, then panned - see the pattern in Friends.tsx for
  // why this avoids the map-rebuild jank bug.
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
        zoom: 12,
      });

      mapRef.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

      const geolocate = new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserHeading: true,
      });
      mapRef.current.addControl(geolocate, 'top-right');
    };

    loadMapbox();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // Intentionally created once per token - see the pan effect below.
  }, [token]);

  // Pan the already-created map when the resolved center changes instead of
  // tearing the whole map down.
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.easeTo({ center: [center.lng, center.lat], duration: 600 });
  }, [center]);

  useEffect(() => {
    if (!mapRef.current) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current.clear();

    const placesWithLocation = places.filter((p) => p.latitude != null && p.longitude != null);
    if (placesWithLocation.length === 0) return;

    const loadMarkers = async () => {
      const mapboxgl = (await import('mapbox-gl')).default;

      placesWithLocation.forEach((place) => {
        // A single malformed place shouldn't be able to abort the loop and
        // leave every place after it (and the fitBounds call below) without
        // a marker - keep failures scoped to just that one place.
        try {
          const el = document.createElement('div');
          el.className =
            'flex items-center justify-center w-8 h-8 bg-primary rounded-full shadow-lg cursor-pointer hover:scale-110 transition-transform';
          el.innerHTML =
            '<svg class="w-4 h-4" fill="white" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>';

          const safeName = place.name.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const categoryLabel = formatCategory(place.category);
          const avgRating = toNumber(place.avg_rating);
          const ratingCount = toNumber(place.rating_count) ?? 0;
          const ratingLine =
            avgRating != null
              ? `<p class="text-sm">${avgRating.toFixed(1)}/10 &middot; ${ratingCount} rating${ratingCount === 1 ? '' : 's'}</p>`
              : '';

          const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
            <div class="p-2">
              <h3 class="font-semibold">${safeName}</h3>
              ${categoryLabel ? `<p class="text-xs text-gray-500">${categoryLabel}</p>` : ''}
              ${ratingLine}
            </div>
          `);

          const marker = new mapboxgl.Marker(el)
            .setLngLat([place.longitude!, place.latitude!])
            .setPopup(popup)
            .addTo(mapRef.current);

          el.addEventListener('click', () => {
            onSelectPlaceRef.current(place);
          });

          markersRef.current.set(place.place_id, marker);
        } catch (err) {
          console.error('Failed to add Explore marker for place:', place.place_id, err);
        }
      });

      const bounds = new mapboxgl.LngLatBounds();
      placesWithLocation.forEach((p) => bounds.extend([p.longitude!, p.latitude!]));
      mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    };

    const checkMap = setInterval(() => {
      if (mapRef.current?.loaded()) {
        clearInterval(checkMap);
        loadMarkers();
      }
    }, 100);

    return () => clearInterval(checkMap);
  }, [places]);

  return <div ref={mapContainer} className="w-full h-full" />;
}
