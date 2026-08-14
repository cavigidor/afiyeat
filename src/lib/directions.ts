import { isNative } from './native';

export interface DirectionsTarget {
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  name?: string | null;
}

/** True if there's enough info to build a directions link at all. */
export function hasDirectionsTarget(t: DirectionsTarget): boolean {
  return (t.latitude != null && t.longitude != null) || !!t.address || !!t.name;
}

// Coordinates are preferred (exact pin), falling back to a text query
// (address, then name) - both Apple and Google's directions URLs happily
// geocode a plain text destination when we don't have a lat/lng, which
// covers Shared List items (that table's row doesn't get selected with
// lat/lng today) and any manually-typed place with no address.
function destinationParam(t: DirectionsTarget): string {
  if (t.latitude != null && t.longitude != null) {
    return `${t.latitude},${t.longitude}`;
  }
  return encodeURIComponent(t.address || t.name || '');
}

export function getAppleMapsUrl(t: DirectionsTarget): string {
  return `https://maps.apple.com/?daddr=${destinationParam(t)}`;
}

export function getGoogleMapsUrl(t: DirectionsTarget): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${destinationParam(t)}`;
}

/**
 * A small "Apple Maps · Google Maps" directions row as raw HTML, for
 * embedding in Mapbox GL popups (which take an HTML string, not React).
 * These render as real <a> elements, so a genuine click - unlike a
 * JS-triggered window.open() - reliably hands off to the native app via
 * each URL's universal link, with no Capacitor plugin involved.
 */
export function getDirectionsPopupHtml(t: DirectionsTarget): string {
  if (!hasDirectionsTarget(t)) return '';
  return `
    <div style="display:flex;gap:10px;margin-top:6px;">
      <a href="${getAppleMapsUrl(t)}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:#2563eb;text-decoration:none;">Apple Maps</a>
      <a href="${getGoogleMapsUrl(t)}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:#2563eb;text-decoration:none;">Google Maps</a>
    </div>
  `;
}

/**
 * Opens a maps URL. On native platforms this goes through
 * @capacitor/browser (SFSafariViewController/Custom Tabs), which - unlike a
 * plain window.open() inside the app's WKWebView - reliably hands off to the
 * Apple Maps / Google Maps app if either is installed, since maps.apple.com
 * and google.com/maps/dir are both registered universal links. On web this
 * is just a normal new-tab link.
 */
export async function openDirections(url: string): Promise<void> {
  if (isNative()) {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
      return;
    } catch (err) {
      console.error('Browser.open failed, falling back to window.open:', err);
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
