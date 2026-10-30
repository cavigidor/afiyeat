import { useQuery } from '@tanstack/react-query';
import { ListChecks } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { ExploreListCard } from '@/components/explore/ExploreListCard';
import { CardGridSkeleton } from '@/components/shared/CardGridSkeleton';
import { communityListKey, fetchCommunityLists, uniqueLists } from '@/lib/communityLists';

/**
 * List results for the search screen: community lists - named and
 * anonymous - whose name, items or types match. The search runs on the
 * server against what each list may show, so private content never
 * matches. The full, pageable search is Explore -> Lists.
 */
export function ListResults({ query }: { query: string }) {
  const { user } = useAuth();
  const term = query.trim();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['community-lists', 'all', term, 'search-preview'],
    queryFn: () => fetchCommunityLists({ mode: 'all', query: term, limit: 20 }),
    enabled: !!user && term.length >= 2,
  });

  if (term.length < 2) return null;
  if (isLoading) return <CardGridSkeleton />;

  const matches = uniqueLists(data?.lists ?? []);
  if (isError || matches.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
        <ListChecks className="h-8 w-8 opacity-60" />
        <p>{isError ? "Couldn't search lists right now." : `No lists match "${query}" yet.`}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {matches.map((list) => (
          <ExploreListCard key={communityListKey(list)} list={list} />
        ))}
      </div>
      {data?.nextOffset != null && (
        <Link to={`/explore?c=lists&q=${encodeURIComponent(term)}`} className="block text-center text-sm font-medium text-primary">
          See all matching lists
        </Link>
      )}
    </div>
  );
}
