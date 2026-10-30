import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { DiscoverySection, Rail } from '@/components/discovery/DiscoverySection';
import { ListTile, TileSkeleton } from '@/components/discovery/DiscoveryTiles';
import { toNumber } from '@/components/explore/ExplorePlaceCard';
import { exploreKeys, fetchExploreLists } from '@/lib/discovery';
import { communityListKey } from '@/lib/communityLists';

const MIN_ITEMS = 3;

/**
 * Lists other people are building - wines, books, coffee shops - so Home
 * shows Afiyeat is more than a place search. Server ordering is "most
 * recently added to", so lively lists come first; your own and near-empty
 * lists are left out.
 */
export function CommunityListsSection() {
  const { user } = useAuth();
  const { data: lists = [], isLoading } = useQuery({
    queryKey: exploreKeys.lists('all'),
    queryFn: () => fetchExploreLists('all'),
    enabled: !!user,
  });

  const worthExploring = useMemo(
    () =>
      lists
        .filter((l) => !(l.user_id && l.user_id === user?.id) && (toNumber(l.item_count) ?? 0) >= MIN_ITEMS)
        .slice(0, 10),
    [lists, user?.id],
  );

  if (isLoading) {
    return (
      <DiscoverySection title="Lists worth exploring">
        <Rail>
          {[0, 1].map((i) => (
            <TileSkeleton key={i} wide />
          ))}
        </Rail>
      </DiscoverySection>
    );
  }

  if (worthExploring.length === 0) return null;

  return (
    <DiscoverySection
      title="Lists worth exploring"
      subtitle="What people on Afiyeat are collecting"
      seeAllTo="/explore?c=lists"
    >
      <Rail>
        {worthExploring.map((list) => (
          <ListTile key={communityListKey(list)} list={list} />
        ))}
      </Rail>
    </DiscoverySection>
  );
}
