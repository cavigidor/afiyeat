import { useEffect, useRef, useState } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { isNative } from '@/lib/native';
import { loadMapKit, searchApplePlaces, type ApplePlace, type MapKit } from '@/lib/appleMaps';

/**
 * Temporary check page for the Apple Maps switch (not linked anywhere).
 * Confirms, on the website and inside the iOS app, that:
 *   1. the server can sign MapKit tokens,
 *   2. MapKit JS draws a map on this origin (capacitor://localhost in the app),
 *   3. place search returns Apple place IDs,
 *   4. Apple's place lookup returns what we expect for those IDs.
 * Remove once the switch is complete.
 */
export default function DevAppleMaps() {
  const [log, setLog] = useState<string[]>([]);
  const [query, setQuery] = useState('pizza');
  const [results, setResults] = useState<ApplePlace[]>([]);
  const [raw, setRaw] = useState<string>('');
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapKit>(null);
  const mkRef = useRef<MapKit>(null);

  const add = (line: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l]);

  useEffect(() => {
    add(`origin: ${window.location.origin} · native: ${isNative()}`);
  }, []);

  const checkToken = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('apple-maps', { body: { action: 'mapkit-token' } });
      if (error) throw error;
      const [header, payload] = String(data.token).split('.').slice(0, 2).map((part) =>
        JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))),
      );
      add(`token OK · kid ${header.kid} · scope ${payload.scope} · origin ${payload.origin} · expires ${new Date(payload.exp * 1000).toLocaleTimeString()}`);
    } catch (err) {
      add(`token FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const showMap = async () => {
    try {
      const mk = await loadMapKit();
      mkRef.current = mk;
      mk.addEventListener?.('error', (e: { status?: string }) => add(`MapKit error event: ${e?.status ?? 'unknown'}`));
      if (!mapRef.current && mapEl.current) {
        mapRef.current = new mk.Map(mapEl.current, {
          center: new mk.Coordinate(40.7128, -74.006),
          cameraDistance: 8000,
          showsCompass: mk.FeatureVisibility?.Hidden,
        });
      }
      add('map loaded - streets in the box = working; a blank grid or an Unauthorized line = not authorised on this origin');
    } catch (err) {
      add(`map FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const runSearch = async () => {
    try {
      const places = await searchApplePlaces(query, { latitude: 40.7128, longitude: -74.006 });
      setResults(places);
      add(`search OK · ${places.length} results · first id ${places[0]?.id ?? '—'}`);
      const mk = mkRef.current;
      const map = mapRef.current;
      if (mk && map) {
        map.removeAnnotations(map.annotations);
        const pins = places
          .filter((p) => p.latitude != null && p.longitude != null)
          .map((p) => new mk.MarkerAnnotation(new mk.Coordinate(p.latitude, p.longitude), { title: p.name ?? '' }));
        map.showItems(pins);
      }
    } catch (err) {
      add(`search FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const lookup = async (id: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('apple-maps', { body: { action: 'probe-lookup', ids: [id] } });
      if (error) throw error;
      setRaw(JSON.stringify(data.raw, null, 2));
      add(`lookup OK for ${id}`);
    } catch (err) {
      add(`lookup FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container max-w-2xl px-4 py-4 space-y-3">
        <h1 className="text-xl font-bold">Apple Maps check</h1>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={checkToken}>1. Token</Button>
          <Button size="sm" onClick={showMap}>2. Map</Button>
          <Input className="w-40" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button size="sm" onClick={runSearch}>3. Search</Button>
        </div>
        <div ref={mapEl} className="h-64 w-full rounded-lg border bg-muted" />
        {results.length > 0 && (
          <Card>
            <CardContent className="p-2 divide-y text-sm">
              {results.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.address} · {p.category ?? 'no category'} · {p.id}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => lookup(p.id)}>4. Lookup</Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
        <pre className="text-xs whitespace-pre-wrap bg-muted rounded p-2 max-h-60 overflow-auto">{log.join('\n')}</pre>
        {raw && <pre className="text-xs whitespace-pre-wrap bg-muted rounded p-2 max-h-80 overflow-auto">{raw}</pre>}
      </main>
    </div>
  );
}
