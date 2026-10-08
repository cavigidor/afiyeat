import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { Loader2, Map as MapIcon } from 'lucide-react';
import { loadMapKit, type MapKit } from '@/lib/appleMaps';
import { createPinElement } from '@/lib/mapPin';
import { getDirectionsPopupHtml } from '@/lib/directions';
import { useLocationPermission } from '@/hooks/useLocationPermission';

/** One pin on the map. */
export interface MapPoint {
  id: string;
  name: string;
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  address?: string | null;
  /** Pin colour and emoji (a list type / folder). */
  color?: string | null;
  icon?: string | null;
  /** Extra lines in the pin's bubble, as plain text. */
  details?: string[];
  /** A round marker instead of the teardrop pin (Explore, events). */
  dot?: { background: string; svgPath: string };
  /** A link in the bubble, e.g. tickets. */
  link?: { url: string; label: string };
  /** Apple/Google directions links in the bubble (default true). */
  directions?: boolean;
}

/** The visible map area after the user pans or zooms. */
export interface MapViewport {
  center: { lat: number; lng: number };
  northEast: { lat: number; lng: number };
}

interface PlaceMapProps {
  points: MapPoint[];
  /** Where to look before there are pins (e.g. the user's location). */
  center?: { lat: number; lng: number } | null;
  focusedId?: string | null;
  /** Called when a pin is tapped. */
  onSelect?: (id: string) => void;
  /** Exposes "fly to this pin and open its bubble" to the page. */
  flyToRef?: MutableRefObject<((lat: number, lng: number, id: string) => void) | null>;
  /** Exposes "centre on me" (asks for location if needed) to the page. */
  flyToMeRef?: MutableRefObject<(() => void) | null>;
  onLocationDenied?: () => void;
  /** Show a name/address/directions bubble when a pin is tapped. */
  showCallouts?: boolean;
  /** Called after the user (or the map) finishes moving the view. */
  onViewportChange?: (viewport: MapViewport) => void;
  /** Rendered over the map (e.g. a "Search this area" button). */
  children?: ReactNode;
  className?: string;
}

const hasCoords = (p: MapPoint): p is MapPoint & { latitude: number; longitude: number } =>
  typeof p.latitude === 'number' && typeof p.longitude === 'number';

function calloutElement(point: MapPoint): HTMLElement {
  // Built with textContent so names and addresses can't inject markup.
  const box = document.createElement('div');
  box.style.padding = '6px 8px';
  box.style.maxWidth = '240px';
  box.style.fontFamily = 'inherit';
  const title = document.createElement('div');
  title.style.fontWeight = '600';
  title.style.fontSize = '14px';
  title.textContent = point.name;
  box.appendChild(title);
  for (const line of [point.address, ...(point.details ?? [])]) {
    if (!line) continue;
    const p = document.createElement('div');
    p.style.fontSize = '12px';
    p.style.color = '#6b7280';
    p.style.marginTop = '2px';
    p.textContent = line;
    box.appendChild(p);
  }
  if (point.link && /^https?:\/\//i.test(point.link.url)) {
    const a = document.createElement('a');
    a.href = point.link.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = point.link.label;
    a.style.fontSize = '12px';
    a.style.color = '#2563eb';
    a.style.textDecoration = 'none';
    a.style.display = 'inline-block';
    a.style.marginTop = '6px';
    box.appendChild(a);
  }
  if (point.directions !== false) {
    // Directions links: URLs are built from encoded coordinates/text only.
    const links = document.createElement('div');
    links.innerHTML = getDirectionsPopupHtml({
      latitude: point.latitude,
      longitude: point.longitude,
      address: point.address,
      name: point.name,
    });
    box.appendChild(links);
  }
  return box;
}

function dotElement(dot: NonNullable<MapPoint['dot']>): HTMLElement {
  const el = document.createElement('div');
  el.style.width = '32px';
  el.style.height = '32px';
  el.style.borderRadius = '9999px';
  el.style.background = dot.background;
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.35)';
  el.style.cursor = 'pointer';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'white');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', dot.svgPath);
  svg.appendChild(path);
  el.appendChild(svg);
  return el;
}

/**
 * The app's map, drawn by Apple Maps (MapKit JS) on the website and in the
 * iOS app. Replaces the Mapbox maps each page used to build for itself.
 */
export function PlaceMap({
  points,
  center,
  focusedId,
  onSelect,
  flyToRef,
  flyToMeRef,
  onLocationDenied,
  showCallouts = true,
  onViewportChange,
  children,
  className = 'w-full h-full',
}: PlaceMapProps) {
  const { requestLocation } = useLocationPermission();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapKit>(null);
  const mkRef = useRef<MapKit>(null);
  const annotationsRef = useRef(new globalThis.Map<string, MapKit>());
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const hasFitted = useRef(false);

  // Keep the latest callbacks without rebuilding the map.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onDeniedRef = useRef(onLocationDenied);
  onDeniedRef.current = onLocationDenied;
  const onViewportRef = useRef(onViewportChange);
  onViewportRef.current = onViewportChange;

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    loadMapKit()
      .then((mk) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        mkRef.current = mk;
        const map = new mk.Map(containerRef.current, {
          showsCompass: mk.FeatureVisibility?.Hidden ?? 'hidden',
          showsMapTypeControl: false,
          showsZoomControl: true,
          showsPointsOfInterest: true,
          isRotationEnabled: false,
        });
        if (center) {
          map.region = {
            center: { latitude: center.lat, longitude: center.lng },
            span: { latitudeDelta: 0.12, longitudeDelta: 0.12 },
          };
        }
        map.addEventListener('select', (event: { annotation?: { data?: { id?: string } } }) => {
          const id = event.annotation?.data?.id;
          if (id) onSelectRef.current?.(id);
        });
        map.addEventListener('region-change-end', () => {
          const region = map.region;
          if (!region) return;
          const lat = region.center.latitude;
          const lng = region.center.longitude;
          onViewportRef.current?.({
            center: { lat, lng },
            northEast: {
              lat: lat + region.span.latitudeDelta / 2,
              lng: lng + region.span.longitudeDelta / 2,
            },
          });
        });
        mapRef.current = map;
        setStatus('ready');
      })
      .catch((err) => {
        console.error('Map failed to load:', err);
        if (!cancelled) setStatus('failed');
      });
    const annotations = annotationsRef.current;
    return () => {
      cancelled = true;
      annotations.clear();
      try {
        mapRef.current?.destroy?.();
      } catch {
        /* already gone */
      }
      mapRef.current = null;
    };
    // The map is created once; centre/points are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fly-to helpers for the page.
  useEffect(() => {
    if (status !== 'ready') return;
    const mk = mkRef.current;
    const flyTo = (lat: number, lng: number, id: string) => {
      const map = mapRef.current;
      if (!map) return;
      map.setRegionAnimated(
        new mk.CoordinateRegion(new mk.Coordinate(lat, lng), new mk.CoordinateSpan(0.006, 0.006)),
        true,
      );
      const annotation = annotationsRef.current.get(id);
      if (annotation) annotation.selected = true;
    };
    const flyToMe = () => {
      requestLocation().then(({ coords, wasDenied }) => {
        if (coords) {
          mapRef.current?.setRegionAnimated(
            new mk.CoordinateRegion(
              new mk.Coordinate(coords.latitude, coords.longitude),
              new mk.CoordinateSpan(0.03, 0.03),
            ),
            true,
          );
        } else if (wasDenied) {
          onDeniedRef.current?.();
        }
      });
    };
    if (flyToRef) flyToRef.current = flyTo;
    if (flyToMeRef) flyToMeRef.current = flyToMe;
    return () => {
      if (flyToRef) flyToRef.current = null;
      if (flyToMeRef) flyToMeRef.current = null;
    };
  }, [status, flyToRef, flyToMeRef, requestLocation]);

  // Pan to the resolved centre while there are no pins to frame.
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map || !center || points.some(hasCoords)) return;
    map.setCenterAnimated(new mkRef.current.Coordinate(center.lat, center.lng), true);
  }, [status, center?.lat, center?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pins.
  const signature = points
    .filter(hasCoords)
    .map((p) => `${p.id}:${p.latitude},${p.longitude}:${p.color ?? ''}:${p.icon ?? ''}:${p.id === focusedId ? 1 : 0}`)
    .join('|');

  useEffect(() => {
    const map = mapRef.current;
    const mk = mkRef.current;
    if (status !== 'ready' || !map || !mk) return;

    map.removeAnnotations(map.annotations);
    annotationsRef.current.clear();

    const located = points.filter(hasCoords);
    const annotations = located.map((point) => {
      const focused = point.id === focusedId;
      const factory = () => {
        if (point.dot) return dotElement(point.dot);
        const el = createPinElement({ color: point.color, icon: point.icon, focused });
        // createPinElement positions itself absolutely for Mapbox; MapKit
        // lays the element out itself.
        el.style.position = 'relative';
        return el;
      };
      const size = focused ? 44 : 32;
      // Teardrop pins sit on their tip; round markers sit on their centre.
      const height = point.dot ? 0 : Math.round(size * ((Math.SQRT2 - 1) / 2 + 1));
      const annotation = new mk.Annotation(new mk.Coordinate(point.latitude, point.longitude), factory, {
        title: point.name,
        data: { id: point.id },
        // Put the pin's tip, not its middle, on the coordinate.
        anchorOffset: new DOMPoint(0, -height / 2),
        calloutEnabled: showCallouts,
        callout: showCallouts ? { calloutContentForAnnotation: () => calloutElement(point) } : undefined,
        displayPriority: focused ? 1000 : 750,
      });
      annotationsRef.current.set(point.id, annotation);
      return annotation;
    });
    map.addAnnotations(annotations);

    // Rebuilding the pins (e.g. to enlarge the focused one) closes any open
    // bubble; reopen the focused place's.
    if (focusedId) {
      const focused = annotationsRef.current.get(focusedId);
      if (focused) focused.selected = true;
    }

    // Frame all pins the first time there are any, and whenever the set
    // changes while nothing is focused.
    if (annotations.length > 0 && (!hasFitted.current || !focusedId)) {
      hasFitted.current = true;
      if (annotations.length === 1) {
        map.setRegionAnimated(
          new mk.CoordinateRegion(
            new mk.Coordinate(located[0].latitude, located[0].longitude),
            new mk.CoordinateSpan(0.02, 0.02),
          ),
          false,
        );
      } else {
        map.showItems(annotations, { animate: false, padding: new mk.Padding(50, 50, 50, 50) });
      }
    }
  }, [status, signature, showCallouts]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className={className} />
      {status === 'ready' && children}
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/40">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}
      {status === 'failed' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground bg-muted/40">
          <MapIcon className="h-12 w-12 mb-4 opacity-50" />
          <p>Map unavailable</p>
        </div>
      )}
    </div>
  );
}
