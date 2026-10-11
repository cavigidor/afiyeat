import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Map as MapIcon, List as ListIcon, LocateFixed, CalendarDays, MapPinOff, Search } from 'lucide-react';
import { CardGridSkeleton } from '@/components/shared/CardGridSkeleton';
import { EventCard } from '@/components/explore/EventCard';
import { EventsMapComponent } from '@/components/explore/EventsMapComponent';
import { useLocationPermission } from '@/hooks/useLocationPermission';
import { fetchNearbyEvents, type EventsDateFilter } from '@/lib/events';

type ExploreView = 'map' | 'list';

interface ExploreEventsProps {
  /** A search to start with - e.g. "Search events for …" from the search screen. */
  keyword?: string;
  onLocationDenied: () => void;
}

/**
 * Explore -> Events: Ticketmaster events near you, with keyword, date and
 * category filters and a map or list. Moved out of Explore.tsx unchanged
 * apart from the keyword prop; it only mounts once Events is opened, which
 * is also when it asks for location (never earlier).
 */
export function ExploreEvents({ keyword, onLocationDenied }: ExploreEventsProps) {
  const eventsFlyToMeRef = useRef<(() => void) | null>(null);
  const { requestLocation } = useLocationPermission();

  const [eventsLocation, setEventsLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [eventsLocationDenied, setEventsLocationDenied] = useState(false);
  // Defaults to a 25mi radius around the device's own location, but
  // "Search this area" on the map overrides both to whatever's currently
  // in view - so events are then found by wherever the user last searched,
  // not always by device GPS.
  const [eventsRadiusMiles, setEventsRadiusMiles] = useState(25);
  const [eventsView, setEventsView] = useState<ExploreView>('map');
  const [eventsDateFilter, setEventsDateFilter] = useState<EventsDateFilter>('all');
  const [eventsCategory, setEventsCategory] = useState<string | null>(null);
  const [eventsKeywordInput, setEventsKeywordInput] = useState(keyword ?? '');
  const [eventsKeyword, setEventsKeyword] = useState(keyword?.trim() ?? '');

  // A new keyword handed in from outside (search screen) replaces the field.
  useEffect(() => {
    if (keyword != null) setEventsKeywordInput(keyword);
  }, [keyword]);

  // Events are found by device location (not stored user data like
  // places/lists are), so it's only requested once Events is actually
  // opened. Uses getCurrentPosition() (via requestLocation) rather than raw
  // navigator.geolocation so this routes through the native Capacitor
  // plugin on iOS.
  useEffect(() => {
    if (eventsLocation || eventsLocationDenied) return;
    requestLocation().then(({ coords }) => {
      if (coords) {
        setEventsLocation({ lat: coords.latitude, lng: coords.longitude });
      } else {
        setEventsLocationDenied(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsLocation, eventsLocationDenied]);

  // Debounced so every keystroke doesn't trigger a Ticketmaster call.
  useEffect(() => {
    const timeoutId = setTimeout(() => setEventsKeyword(eventsKeywordInput.trim()), 400);
    return () => clearTimeout(timeoutId);
  }, [eventsKeywordInput]);

  // Rounded to ~1km precision for the cache key so small GPS jitter between
  // renders doesn't trigger a refetch every time.
  const eventsLocationKey = eventsLocation
    ? `${eventsLocation.lat.toFixed(2)},${eventsLocation.lng.toFixed(2)}`
    : null;
  const { data: events = [], isLoading: eventsLoading, isError: eventsErrored } = useQuery({
    queryKey: ['explore-events', eventsLocationKey, eventsRadiusMiles, eventsKeyword, eventsDateFilter],
    queryFn: () =>
      fetchNearbyEvents(eventsLocation!.lat, eventsLocation!.lng, eventsKeyword, eventsDateFilter, eventsRadiusMiles),
    enabled: !!eventsLocation,
    staleTime: 10 * 60 * 1000,
  });

  const handleSearchThisArea = (newCenter: { lat: number; lng: number }, radiusMiles: number) => {
    setEventsLocation(newCenter);
    setEventsRadiusMiles(radiusMiles);
  };

  // Category options are derived from whatever Ticketmaster actually
  // returned (Music/Sports/Arts & Theatre/etc), so the pills never offer a
  // category with zero results - filtered client-side since we already
  // have the full batch in hand.
  const availableEventCategories = useMemo(
    () => Array.from(new Set(events.map((e) => e.category).filter((c): c is string => !!c))).sort(),
    [events],
  );

  useEffect(() => {
    if (eventsCategory && !availableEventCategories.includes(eventsCategory)) {
      setEventsCategory(null);
    }
  }, [availableEventCategories, eventsCategory]);

  const filteredEvents = useMemo(
    () => (eventsCategory ? events.filter((e) => e.category === eventsCategory) : events),
    [events, eventsCategory],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground flex items-center gap-1.5 min-w-0">
          <CalendarDays className="h-4 w-4 shrink-0" />
          <span>Concerts, games and shows near you, from Ticketmaster.</span>
        </p>
        <Tabs value={eventsView} onValueChange={(v) => setEventsView(v as ExploreView)} className="shrink-0">
          <TabsList>
            <TabsTrigger value="map" className="gap-1.5">
              <MapIcon className="h-3.5 w-3.5" />
              Map
            </TabsTrigger>
            <TabsTrigger value="list" className="gap-1.5">
              <ListIcon className="h-3.5 w-3.5" />
              List
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {eventsLocationDenied && !eventsLocation ? (
        <div className="text-center py-24 bg-card rounded-xl">
          <MapPinOff className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-2">Location access needed</h3>
          <p className="text-muted-foreground">
            Turn on location for Afiyeat to see events happening near you.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search events (artist, team, venue...)"
                value={eventsKeywordInput}
                onChange={(e) => setEventsKeywordInput(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={eventsDateFilter} onValueChange={(v) => setEventsDateFilter(v as EventsDateFilter)}>
              <SelectTrigger className="w-full sm:w-[160px] h-9 shrink-0">
                <SelectValue placeholder="When" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This week</SelectItem>
                <SelectItem value="month">This month</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {availableEventCategories.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <Badge
                interactive
                variant={eventsCategory === null ? 'default' : 'outline'}
                onClick={() => setEventsCategory(null)}
              >
                All
              </Badge>
              {availableEventCategories.map((category) => (
                <Badge
                  key={category}
                  interactive
                  variant={eventsCategory === category ? 'default' : 'outline'}
                  onClick={() => setEventsCategory(eventsCategory === category ? null : category)}
                >
                  {category}
                </Badge>
              ))}
            </div>
          )}

          {!eventsLocation || eventsLoading ? (
            <CardGridSkeleton />
          ) : eventsErrored ? (
            <div className="text-center py-24 bg-card rounded-xl">
              <CalendarDays className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">Couldn't load events</h3>
              <p className="text-muted-foreground">Give it another try in a moment.</p>
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="text-center py-24 bg-card rounded-xl">
              <CalendarDays className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">Nothing found</h3>
              <p className="text-muted-foreground">
                Try a different search, date range, or category.
              </p>
            </div>
          ) : eventsView === 'map' ? (
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="h-[60vh] sm:h-[65vh] relative">
                  <>
                      <EventsMapComponent
                        events={filteredEvents}
                        center={eventsLocation}
                        flyToMeRef={eventsFlyToMeRef}
                        onSearchThisArea={handleSearchThisArea}
                        onLocationDenied={onLocationDenied}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="absolute bottom-4 left-4 shadow-md gap-1.5 z-10"
                        onClick={() => eventsFlyToMeRef.current?.()}
                      >
                        <LocateFixed className="h-4 w-4" />
                        Near Me
                      </Button>
                    </>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredEvents.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
