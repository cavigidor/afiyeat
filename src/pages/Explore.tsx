import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
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
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  Loader2,
  Map as MapIcon,
  List as ListIcon,
  Compass,
  LocateFixed,
  Users2,
  CalendarDays,
  MapPinOff,
  Search,
} from 'lucide-react';
import { ExploreMapComponent } from '@/components/explore/ExploreMapComponent';
import { ExplorePlaceCard, type ExplorePlace } from '@/components/explore/ExplorePlaceCard';
import { PlaceDetailSheet } from '@/components/explore/PlaceDetailSheet';
import { ExploreListCard, type ExploreList } from '@/components/explore/ExploreListCard';
import { EventCard, type TicketmasterEvent } from '@/components/explore/EventCard';
import { EventsMapComponent } from '@/components/explore/EventsMapComponent';

type ExploreMode = 'friends' | 'all';
type ExploreView = 'map' | 'list';
type ExploreContentType = 'restaurants' | 'lists' | 'events';
type EventsDateFilter = 'all' | 'today' | 'week' | 'month';

async function fetchMapboxTokenValue(): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('get-mapbox-token');
  if (error) throw error;
  return data?.token ?? null;
}

async function fetchExplorePlaces(mode: ExploreMode): Promise<ExplorePlace[]> {
  const { data, error } = await supabase.rpc('get_explore_places', { p_mode: mode });
  if (error) throw error;
  return (data || []) as ExplorePlace[];
}

async function fetchExploreLists(mode: ExploreMode): Promise<ExploreList[]> {
  const { data, error } = await supabase.rpc('get_explore_lists', { p_mode: mode });
  if (error) throw error;
  return (data || []) as ExploreList[];
}

// Ticketmaster wants a UTC window, not a filter keyword - so "Today" /
// "This Week" / "This Month" are translated into startDateTime/endDateTime
// here and sent to the edge function, rather than filtered client-side out
// of the (size-capped) results already fetched.
function getEventsDateRange(filter: EventsDateFilter): { startDateTime?: string; endDateTime?: string } {
  if (filter === 'all') return {};
  const now = new Date();
  const end = new Date(now);
  if (filter === 'today') {
    end.setHours(23, 59, 59, 999);
  } else if (filter === 'week') {
    end.setDate(end.getDate() + 7);
  } else {
    end.setDate(end.getDate() + 30);
  }
  return { startDateTime: now.toISOString(), endDateTime: end.toISOString() };
}

async function fetchNearbyEvents(
  latitude: number,
  longitude: number,
  keyword: string,
  dateFilter: EventsDateFilter,
): Promise<TicketmasterEvent[]> {
  const { startDateTime, endDateTime } = getEventsDateRange(dateFilter);
  const { data, error } = await supabase.functions.invoke('search-events', {
    body: {
      latitude,
      longitude,
      keyword: keyword || undefined,
      startDateTime,
      endDateTime,
    },
  });
  if (error) throw error;
  return (data?.events || []) as TicketmasterEvent[];
}

export default function Explore() {
  const { user, session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [contentType, setContentType] = useState<ExploreContentType>('restaurants');
  const [mode, setMode] = useState<ExploreMode>('all');
  const [view, setView] = useState<ExploreView>('map');
  const [selectedPlace, setSelectedPlace] = useState<ExplorePlace | null>(null);
  const flyToMeRef = useRef<(() => void) | null>(null);
  const eventsFlyToMeRef = useRef<(() => void) | null>(null);

  const [eventsLocation, setEventsLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [eventsLocationDenied, setEventsLocationDenied] = useState(false);
  const [eventsView, setEventsView] = useState<ExploreView>('map');
  const [eventsDateFilter, setEventsDateFilter] = useState<EventsDateFilter>('all');
  const [eventsCategory, setEventsCategory] = useState<string | null>(null);
  const [eventsKeywordInput, setEventsKeywordInput] = useState('');
  const [eventsKeyword, setEventsKeyword] = useState('');

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  // Events are found by device location (not stored user data like
  // restaurants/lists are), so it's only requested once the Events tab is
  // actually opened rather than eagerly on page load.
  useEffect(() => {
    if (contentType !== 'events' || eventsLocation || eventsLocationDenied) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setEventsLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      (error) => {
        console.log('Location not available for events:', error.message);
        setEventsLocationDenied(true);
      },
    );
  }, [contentType, eventsLocation, eventsLocationDenied]);

  // Debounced so every keystroke doesn't trigger a Ticketmaster call.
  useEffect(() => {
    const timeoutId = setTimeout(() => setEventsKeyword(eventsKeywordInput.trim()), 400);
    return () => clearTimeout(timeoutId);
  }, [eventsKeywordInput]);

  // Doesn't change per-user - shared cache key with Friends.tsx/Profile.tsx.
  // Gated on session (not just user) so it doesn't fire - and permanently
  // fail/cache an error - before the auth token needed by the edge function
  // is actually attached, same as the other pages that fetch this.
  const { data: mapboxToken, isLoading: mapboxLoading } = useQuery({
    queryKey: ['mapbox-token'],
    queryFn: fetchMapboxTokenValue,
    enabled: !!session,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const { data: places = [], isLoading: placesLoading } = useQuery({
    queryKey: ['explore-places', mode],
    queryFn: () => fetchExplorePlaces(mode),
    enabled: !!user && contentType === 'restaurants',
  });

  const { data: lists = [], isLoading: listsLoading } = useQuery({
    queryKey: ['explore-lists', mode],
    queryFn: () => fetchExploreLists(mode),
    enabled: !!user && contentType === 'lists',
  });

  // Rounded to ~1km precision for the cache key so small GPS jitter between
  // renders doesn't trigger a refetch every time.
  const eventsLocationKey = eventsLocation
    ? `${eventsLocation.lat.toFixed(2)},${eventsLocation.lng.toFixed(2)}`
    : null;
  const { data: events = [], isLoading: eventsLoading, isError: eventsErrored } = useQuery({
    queryKey: ['explore-events', eventsLocationKey, eventsKeyword, eventsDateFilter],
    queryFn: () => fetchNearbyEvents(eventsLocation!.lat, eventsLocation!.lng, eventsKeyword, eventsDateFilter),
    enabled: !!user && contentType === 'events' && !!eventsLocation,
    staleTime: 10 * 60 * 1000,
  });

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

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container py-4 sm:py-8 px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 mb-4 sm:mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
              <Compass className="h-6 w-6 sm:h-7 sm:w-7" />
              Explore
            </h1>

            <div className="flex items-center gap-2 flex-wrap">
              {contentType !== 'events' && (
                <Tabs value={mode} onValueChange={(v) => setMode(v as ExploreMode)}>
                  <TabsList>
                    <TabsTrigger value="all">
                      {contentType === 'restaurants' ? 'All around the world' : 'Everyone'}
                    </TabsTrigger>
                    <TabsTrigger value="friends">Friends</TabsTrigger>
                  </TabsList>
                </Tabs>
              )}

              {contentType === 'restaurants' && (
                <Tabs value={view} onValueChange={(v) => setView(v as ExploreView)}>
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
              )}

              {contentType === 'events' && (
                <Tabs value={eventsView} onValueChange={(v) => setEventsView(v as ExploreView)}>
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
              )}
            </div>
          </div>

          <Tabs value={contentType} onValueChange={(v) => setContentType(v as ExploreContentType)}>
            <TabsList>
              <TabsTrigger value="restaurants">Restaurants</TabsTrigger>
              <TabsTrigger value="lists">Other Lists</TabsTrigger>
              <TabsTrigger value="events" className="gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                Events
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {contentType === 'lists' ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Users2 className="h-4 w-4 shrink-0" />
              {mode === 'friends'
                ? 'See what people you follow are up to - browse the lists they\'re building.'
                : "See what people are up to - browse lists other Afiyeat users are building, beyond just restaurants."}
            </p>

            {listsLoading ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : lists.length === 0 ? (
              <div className="text-center py-24 bg-card rounded-xl">
                <Compass className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium mb-2">Nothing to explore yet</h3>
                <p className="text-muted-foreground">
                  {mode === 'friends'
                    ? 'Lists made by people you follow will show up here.'
                    : 'Lists made by you and public profiles will show up here.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {lists.map((list) => (
                  <ExploreListCard key={list.list_id} list={list} />
                ))}
              </div>
            )}
          </div>
        ) : contentType === 'events' ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 shrink-0" />
              Concerts, shows, and things happening near you - powered by Ticketmaster.
            </p>

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
                      variant={eventsCategory === null ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => setEventsCategory(null)}
                    >
                      All
                    </Badge>
                    {availableEventCategories.map((category) => (
                      <Badge
                        key={category}
                        variant={eventsCategory === category ? 'default' : 'outline'}
                        className="cursor-pointer"
                        onClick={() => setEventsCategory(eventsCategory === category ? null : category)}
                      >
                        {category}
                      </Badge>
                    ))}
                  </div>
                )}

                {!eventsLocation || eventsLoading ? (
                  <div className="flex items-center justify-center py-24">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
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
                        {mapboxToken ? (
                          <>
                            <EventsMapComponent
                              token={mapboxToken}
                              events={filteredEvents}
                              center={eventsLocation}
                              flyToMeRef={eventsFlyToMeRef}
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
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                            <MapIcon className="h-12 w-12 mb-4 opacity-50" />
                            <p>Map unavailable</p>
                          </div>
                        )}
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
        ) : placesLoading || mapboxLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : places.length === 0 ? (
          <div className="text-center py-24 bg-card rounded-xl">
            <Compass className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-2">Nothing to explore yet</h3>
            <p className="text-muted-foreground">
              {mode === 'friends'
                ? "Places you and people you follow have visited will show up here."
                : 'Places added by you and public profiles will show up here.'}
            </p>
          </div>
        ) : view === 'map' ? (
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="h-[60vh] sm:h-[65vh] relative">
                {mapboxToken ? (
                  <>
                    <ExploreMapComponent
                      token={mapboxToken}
                      places={places}
                      onSelectPlace={setSelectedPlace}
                      flyToMeRef={flyToMeRef}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="absolute bottom-4 left-4 shadow-md gap-1.5 z-10"
                      onClick={() => flyToMeRef.current?.()}
                    >
                      <LocateFixed className="h-4 w-4" />
                      Near Me
                    </Button>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    <MapIcon className="h-12 w-12 mb-4 opacity-50" />
                    <p>Map unavailable</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {places.map((place) => (
              <ExplorePlaceCard
                key={place.place_id}
                place={place}
                onClick={() => setSelectedPlace(place)}
              />
            ))}
          </div>
        )}
      </main>

      <PlaceDetailSheet
        place={selectedPlace}
        mode={mode}
        onOpenChange={(open) => !open && setSelectedPlace(null)}
      />
    </div>
  );
}
