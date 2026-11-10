import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListChecks } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ExploreListCard } from '@/components/explore/ExploreListCard';
import { CardGridSkeleton } from '@/components/shared/CardGridSkeleton';
import { exploreKeys, fetchExploreLists } from '@/lib/discovery';

/**
 * List results for the search screen: lists people are building (and your
 * own), matched by name. Filters the same community lists Explore and
 * Home already load - no separate search backend.
 */
export function ListResults({ query }: { query: string }) {
  const { user } = useAuth();
  const { data: lists = [], isLoading } = useQuery({
    queryKey: exploreKeys.lists('all'),
    queryFn: () => fetchExploreLists('all'),
    enabled: !!user,
  });

  const term = query.trim().toLowerCase();
  const matches = useMemo(
    () => (term.length < 2 ? [] : lists.filter((l) => !l.is_anonymous && l.list_name.toLowerCase().includes(term))),
    [lists, term],
  );

  if (term.length < 2) return null;
  if (isLoading) return <CardGridSkeleton />;

  if (matches.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
        <ListChecks className="h-8 w-8 opacity-60" />
        <p>No lists called "{query}" yet.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {matches.map((list) => (
        <ExploreListCard key={list.list_id} list={list} />
      ))}
    </div>
  );
}
