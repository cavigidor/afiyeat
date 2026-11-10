import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DiscoverySection, Rail } from '@/components/discovery/DiscoverySection';
import { PlaceTile, TileSkeleton } from '@/components/discovery/DiscoveryTiles';
import type { ExplorePlace } from '@/components/explore/ExplorePlaceCard';
import { ALL_PLACES_PATH, exploreKeys, fetchExplorePlaces, rankPopularPlaces, type Origin } from '@/lib/discovery';

async function fetchOwnSaved(userId: string) {
  const { data, error } = await supabase
    .from('restaurants')
    .select('apple_place_id, name')
    .eq('user_id', userId);
  if (error) throw error;
  return {
    appleIds: new Set((data || []).map((r) => r.apple_place_id).filter((id): id is string => !!id)),
    names: new Set((data || []).map((r) => r.name.trim().toLowerCase())),
  };
}

interface PopularPlacesSectionProps {
  origin: Origin | null;
  onOpen: (place: ExplorePlace) => void;
  onSave: (place: ExplorePlace) => void;
}

/**
 * Home's "For you" slot. There's no personal recommendation engine yet, so
 * this says exactly what it is: the places the most people on Afiyeat have
 * been to - near you if location is already allowed - minus the ones
 * you've saved yourself. rankPopularPlaces is where a real ranker plugs in.
 */
export function PopularPlacesSection({ origin, onOpen, onSave }: PopularPlacesSectionProps) {
  const { user } = useAuth();

  const { data: places = [], isLoading } = useQuery({
    queryKey: exploreKeys.places('all'),
    queryFn: () => fetchExplorePlaces('all'),
    enabled: !!user,
  });

  const { data: own } = useQuery({
    queryKey: ['home-own-saved', user?.id],
    queryFn: () => fetchOwnSaved(user!.id),
    enabled: !!user,
  });

  const ranked = useMemo(
    () =>
      rankPopularPlaces(places, {
        origin,
        excludeAppleIds: own?.appleIds ?? new Set(),
        excludeNames: own?.names ?? new Set(),
      }),
    [places, origin, own],
  );

  if (isLoading) {
    return (
      <DiscoverySection title="Popular on Afiyeat">
        <Rail>
          {[0, 1, 2].map((i) => (
            <TileSkeleton key={i} />
          ))}
        </Rail>
      </DiscoverySection>
    );
  }

  // Too few to be worth a row (a brand-new community) - leave it out
  // rather than show one lonely card.
  if (ranked.places.length < 2) return null;

  const nearby = ranked.strategy === 'nearby';
  return (
    <DiscoverySection
      title={nearby ? 'Popular near you' : 'Popular on Afiyeat'}
      subtitle={
        nearby
          ? 'Where the most people around you have been'
          : 'Where the most people on Afiyeat have been'
      }
      // The row mixes restaurants, cafés and bars, so "See all" opens
      // Explore -> All (every place), not one category.
      seeAllTo={ALL_PLACES_PATH}
    >
      <Rail>
        {ranked.places.map((place) => (
          <PlaceTile
            key={place.place_id}
            place={place}
            onOpen={() => onOpen(place)}
            onSave={() => onSave(place)}
          />
        ))}
      </Rail>
    </DiscoverySection>
  );
}
