// Demo build only. Canned answers for the apple-maps Edge Function: place search over a small set of
// invented places, "resolve" for their ids, and no MapKit token (the demo map stands in for MapKit).
import type { ApplePlace } from '@/lib/appleMaps';

const P = (id: string, name: string, address: string, dx: number, dy: number, category: string, countryCode = 'US'): ApplePlace => ({
  id: `demo-${id}`, name, address, latitude: 41.8935 + dy * 0.004, longitude: -87.6345 + dx * 0.005, category, countryCode,
});

export const DEMO_PLACES: ApplePlace[] = [
  P('1', 'Osteria Lumen', '402 N Wells St, Chicago, IL', -2, 0, 'Restaurant'),
  P('2', 'Golden Hour Café', '75 E Walton St, Chicago, IL', 2, 4, 'Cafe'),
  P('3', 'Ferment & Co. Brewery', '1200 W Fulton Market, Chicago, IL', -6, -2, 'Brewery'),
  P('4', 'Northside Wine Bar', '845 N Clark St, Chicago, IL', -1, 3, 'Winery'),
  P('5', 'Paper Plane Books', '29 E Oak St, Chicago, IL', 1, 5, 'Store'),
  P('6', 'Cardamom Bakery', '160 W Superior St, Chicago, IL', -1, 1, 'Bakery'),
  P('7', 'Riverwalk Tacos', '33 W Wacker Dr, Chicago, IL', 0, -3, 'Restaurant'),
  P('8', 'Ritual Roasters', '510 N Halsted St, Chicago, IL', -4, 0, 'Cafe'),
  P('9', 'Market Hall Grocers', '700 N Dearborn St, Chicago, IL', 0, 2, 'Store'),
  P('10', 'Shoyu Ramen Bar', '230 W Huron St, Chicago, IL', -2, -1, 'Restaurant'),
];

export function demoApplePlaces(body: Record<string, unknown>) {
  const action = String(body.action ?? '');
  if (action === 'search') {
    const q = String(body.query ?? '').trim().toLowerCase();
    if (!q) return { results: [] };
    const words = q.split(/\s+/);
    return { results: DEMO_PLACES.filter((p) => words.every((w) => `${p.name} ${p.category} ${p.address}`.toLowerCase().includes(w))).slice(0, 8) };
  }
  if (action === 'resolve') {
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    return { places: Object.fromEntries(DEMO_PLACES.filter((p) => ids.includes(p.id)).map((p) => [p.id, p])) };
  }
  return { error: 'Not available in the demo.' };
}
