import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Map as MapIcon, List as ListIcon, Compass } from 'lucide-react';
import { ExploreMapComponent } from '@/components/explore/ExploreMapComponent';
import { ExplorePlaceCard, type ExplorePlace } from '@/components/explore/ExplorePlaceCard';
import { PlaceDetailSheet } from '@/components/explore/PlaceDetailSheet';

type ExploreMode = 'friends' | 'all';
type ExploreView = 'map' | 'list';

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

export default function Explore() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<ExploreMode>('all');
  const [view, setView] = useState<ExploreView>('map');
  const [selectedPlace, setSelectedPlace] = useState<ExplorePlace | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  // Doesn't change per-user - shared cache key with Friends.tsx/Profile.tsx.
  const { data: mapboxToken, isLoading: mapboxLoading } = useQuery({
    queryKey: ['mapbox-token'],
    queryFn: fetchMapboxTokenValue,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const { data: places = [], isLoading: placesLoading } = useQuery({
    queryKey: ['explore-places', mode],
    queryFn: () => fetchExplorePlaces(mode),
    enabled: !!user,
  });

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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 sm:mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <Compass className="h-6 w-6 sm:h-7 sm:w-7" />
            Explore
          </h1>

          <div className="flex items-center gap-2">
            <Tabs value={mode} onValueChange={(v) => setMode(v as ExploreMode)}>
              <TabsList>
                <TabsTrigger value="all">All Nearby</TabsTrigger>
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
        </div>

        {placesLoading || mapboxLoading ? (
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
                  <ExploreMapComponent
                    token={mapboxToken}
                    places={places}
                    onSelectPlace={setSelectedPlace}
                  />
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
