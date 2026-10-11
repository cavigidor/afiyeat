import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { useAuth } from '@/contexts/AuthContext';
import { HomeHeader } from '@/components/home/HomeHeader';
import { CategoryTiles } from '@/components/discovery/CategoryRail';
import { PopularPlacesSection } from '@/components/home/PopularPlacesSection';
import { CircleSection } from '@/components/home/CircleSection';
import { HappeningSoonSection } from '@/components/home/HappeningSoonSection';
import { CommunityListsSection } from '@/components/home/CommunityListsSection';
import { PlaceDetailSheet } from '@/components/explore/PlaceDetailSheet';
import { AddExplorePlaceDialog } from '@/components/explore/AddExplorePlaceDialog';
import type { ExplorePlace } from '@/components/explore/ExplorePlaceCard';
import { useGrantedLocation } from '@/hooks/useGrantedLocation';
import { Spinner } from '@/components/ui/spinner';

/**
 * Home: "what's worth checking out?" The signed-in starting screen.
 *
 * Every section is built from real data and leaves itself out when it has
 * nothing to show, so a new account sees a short, honest page rather than
 * a wall of empty boxes:
 *   - Popular (near you / on Afiyeat)  - get_explore_places, ranked
 *   - From your circle                 - follows + their recent saves/lists
 *   - Happening this week              - Ticketmaster, if location allowed
 *   - Lists worth exploring            - get_explore_lists
 */
export default function Home() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [openPlace, setOpenPlace] = useState<ExplorePlace | null>(null);
  const [savePlace, setSavePlace] = useState<ExplorePlace | null>(null);
  const { data: origin = null, isFetched: locationKnown } = useGrantedLocation(!!user);

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [user, authLoading, navigate]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container max-w-3xl py-4 sm:py-8 px-4 sm:px-6 lg:px-8 space-y-7">
        <HomeHeader />
        <CategoryTiles />
        <PopularPlacesSection origin={origin} onOpen={setOpenPlace} onSave={setSavePlace} />
        <CircleSection />
        <HappeningSoonSection origin={origin} locationKnown={locationKnown} />
        <CommunityListsSection />
      </main>

      <PlaceDetailSheet
        place={openPlace}
        mode="all"
        onOpenChange={(open) => !open && setOpenPlace(null)}
        onAddToList={(place) => {
          setOpenPlace(null);
          setSavePlace(place);
        }}
      />
      <AddExplorePlaceDialog
        open={!!savePlace}
        onOpenChange={(open) => !open && setSavePlace(null)}
        place={savePlace}
      />
    </div>
  );
}
