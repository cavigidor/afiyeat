import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { CardGridSkeleton } from '@/components/shared/CardGridSkeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import {
  categoryById,
  exploreKeys,
  fetchExplorePlaces,
  isEnabledCategory,
  placeCategoryOf,
  rankPopularPlaces,
  type DiscoveryCategoryId,
  type ExploreMode,
  type PlaceCategoryId,
} from '@/lib/discovery';
import { Map as MapIcon, List as ListIcon, Compass, LocateFixed, Search, ChevronRight } from 'lucide-react';
import { ExploreMapComponent } from '@/components/explore/ExploreMapComponent';
import { ExplorePlaceCard, type ExplorePlace } from '@/components/explore/ExplorePlaceCard';
import { PlaceDetailSheet } from '@/components/explore/PlaceDetailSheet';
import { ExploreEvents } from '@/components/explore/ExploreEvents';
import { LocationDeniedDialog } from '@/components/shared/LocationDeniedDialog';
import { AddExplorePlaceDialog } from '@/components/explore/AddExplorePlaceDialog';
import { CategoryChips } from '@/components/discovery/CategoryRail';
import { DiscoverySection, Rail } from '@/components/discovery/DiscoverySection';
import { PlaceTile } from '@/components/discovery/DiscoveryTiles';
import { Spinner } from '@/components/ui/spinner';
import Recipes from './Recipes';

type ExploreView = 'map' | 'list';
type FoodView = 'places' | 'recipes';

const EMPTY_COPY: Record<PlaceCategoryId, { all: string; friends: string }> = {
  food: {
    all: 'Restaurants people on Afiyeat have been to will show up here.',
    friends: 'Restaurants you and people you follow have been to will show up here.',
  },
  coffee: {
    all: 'Cafés people on Afiyeat have been to will show up here.',
    friends: 'Cafés you and people you follow have been to will show up here.',
  },
  drinks: {
    all: 'Bars, breweries and wineries people have been to will show up here.',
    friends: 'Bars you and people you follow have been to will show up here.',
  },
};

/**
 * Explore: "I want to find something." Category chips across the top
 * (Food, Coffee, Drinks, Events - see DISCOVERY_CATEGORIES), then:
 *   - Food / Coffee / Drinks: the most-visited places in that category,
 *     then every place on a map or list (Everyone / Friends). Food also
 *     has Recipes - the screen that used to be the Foodie tab.
 *   - Events: Ticketmaster events near you.
 *
 * Deep-linkable: /explore?c=coffee, /explore?c=food&tab=recipes,
 * /explore?c=events&q=jazz. Opening /explore with no parameters (the tab
 * bar) keeps whatever was open last, since this tab stays mounted.
 */
export default function Explore() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [category, setCategory] = useState<DiscoveryCategoryId>('food');
  const [foodView, setFoodView] = useState<FoodView>('places');
  const [eventsKeyword, setEventsKeyword] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<ExploreMode>('all');
  const [view, setView] = useState<ExploreView>('map');
  const [selectedPlace, setSelectedPlace] = useState<ExplorePlace | null>(null);
  const [addPlaceTarget, setAddPlaceTarget] = useState<ExplorePlace | null>(null);
  const flyToMeRef = useRef<(() => void) | null>(null);
  const [locationDeniedOpen, setLocationDeniedOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  // Follow the URL while this screen is the one showing. This page stays
  // mounted under other routes (PersistentTabs), so it only reads the URL
  // when the URL is actually its own.
  useEffect(() => {
    if (location.pathname !== '/explore') return;
    const params = new URLSearchParams(location.search);
    const c = params.get('c');
    if (!isEnabledCategory(c)) return;
    setCategory(c);
    if (c === 'food') setFoodView(params.get('tab') === 'recipes' ? 'recipes' : 'places');
    if (c === 'events') setEventsKeyword(params.get('q') ?? undefined);
  }, [location.pathname, location.search]);

  const goTo = (c: DiscoveryCategoryId, tab?: FoodView) => {
    navigate(`/explore?c=${c}${tab === 'recipes' ? '&tab=recipes' : ''}`, { replace: true });
  };

  const placeCategory: PlaceCategoryId | null =
    category === 'food' || category === 'coffee' || category === 'drinks' ? category : null;
  const showingPlaces = !!placeCategory && !(category === 'food' && foodView === 'recipes');

  const { data: allPlaces = [], isLoading: placesLoading } = useQuery({
    queryKey: exploreKeys.places(mode),
    queryFn: () => fetchExplorePlaces(mode),
    enabled: !!user && showingPlaces,
  });

  const places = useMemo(
    () => (placeCategory ? allPlaces.filter((p) => placeCategoryOf(p.category) === placeCategory) : []),
    [allPlaces, placeCategory],
  );

  // "Most visited" rail above the map: the same ranking as Home's Popular
  // section, within this category and audience.
  const popular = useMemo(
    () =>
      rankPopularPlaces(places, { origin: null, excludeAppleIds: new Set(), excludeNames: new Set(), limit: 8 }).places.filter(
        (p) => Number(p.contributor_count) > 1,
      ),
    [places],
  );

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const categoryLabel = categoryById(category).label;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container py-4 sm:py-8 px-4 sm:px-6 lg:px-8 space-y-4 sm:space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
              <Compass className="h-6 w-6 sm:h-7 sm:w-7" />
              Explore
            </h1>
            <Button asChild variant="outline" size="sm" className="rounded-full gap-1.5">
              <Link to="/search">
                <Search className="h-4 w-4" />
                Search
              </Link>
            </Button>
          </div>
          <CategoryChips value={category} onChange={(c) => goTo(c)} />
        </div>

        {category === 'food' && (
          <Tabs value={foodView} onValueChange={(v) => goTo('food', v as FoodView)}>
            <TabsList>
              <TabsTrigger value="places">Places</TabsTrigger>
              <TabsTrigger value="recipes">Recipes</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {category === 'events' ? (
          <ExploreEvents keyword={eventsKeyword} onLocationDenied={() => setLocationDeniedOpen(true)} />
        ) : category === 'food' && foodView === 'recipes' ? (
          <Recipes embedded />
        ) : placeCategory ? (
          <>
            {!placesLoading && popular.length >= 2 && (
              <DiscoverySection
                title={mode === 'friends' ? 'Most visited by your circle' : 'Most visited'}
                subtitle={`${categoryLabel} spots the most people have been to`}
              >
                <Rail>
                  {popular.map((place) => (
                    <PlaceTile
                      key={place.place_id}
                      place={place}
                      onOpen={() => setSelectedPlace(place)}
                      onSave={() => setAddPlaceTarget(place)}
                    />
                  ))}
                </Rail>
              </DiscoverySection>
            )}

            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Tabs value={mode} onValueChange={(v) => setMode(v as ExploreMode)}>
                <TabsList>
                  <TabsTrigger value="all">Everyone</TabsTrigger>
                  <TabsTrigger value="friends">Friends</TabsTrigger>
                </TabsList>
              </Tabs>
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
            </div>

            {placesLoading ? (
              <CardGridSkeleton />
            ) : places.length === 0 ? (
              <div className="text-center py-16 sm:py-24 bg-card rounded-xl px-6">
                <div className="text-4xl mb-3" aria-hidden>
                  {categoryById(placeCategory).emoji}
                </div>
                <h3 className="text-lg font-medium mb-2">Nothing here yet</h3>
                <p className="text-muted-foreground">{EMPTY_COPY[placeCategory][mode]}</p>
              </div>
            ) : view === 'map' ? (
              <Card className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="h-[60vh] sm:h-[65vh] relative">
                    <ExploreMapComponent
                      places={places}
                      onSelectPlace={setSelectedPlace}
                      flyToMeRef={flyToMeRef}
                      onLocationDenied={() => setLocationDeniedOpen(true)}
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
                    onAdd={() => setAddPlaceTarget(place)}
                  />
                ))}
              </div>
            )}

            {/* Lists moved to Lists -> Discover; keep a way there from here. */}
            <Link
              to="/my-lists?tab=discover"
              className="active-press flex items-center gap-3 rounded-xl border bg-card p-4 transition-[background-color,transform] duration-150 ease-out active:bg-muted/60"
            >
              <span aria-hidden className="text-xl">📋</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Browse lists people are building</span>
                <span className="block text-sm text-muted-foreground">Wines, books, coffee shops and more</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </Link>
          </>
        ) : null}
      </main>

      <PlaceDetailSheet
        place={selectedPlace}
        mode={mode}
        onOpenChange={(open) => !open && setSelectedPlace(null)}
        onAddToList={(place) => {
          setSelectedPlace(null);
          setAddPlaceTarget(place);
        }}
      />

      <AddExplorePlaceDialog
        open={!!addPlaceTarget}
        onOpenChange={(open) => !open && setAddPlaceTarget(null)}
        place={addPlaceTarget}
      />

      <LocationDeniedDialog open={locationDeniedOpen} onOpenChange={setLocationDeniedOpen} />
    </div>
  );
}
