import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Compass, Search, EyeOff } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CardGridSkeleton } from '@/components/shared/CardGridSkeleton';
import { ExploreListCard } from '@/components/explore/ExploreListCard';
import { Spinner } from '@/components/ui/spinner';
import { communityListKey, fetchCommunityLists, uniqueLists, type CommunityMode } from '@/lib/communityLists';

interface CommunityListsBrowserProps {
  /** Starting search (e.g. from the URL). */
  initialQuery?: string;
  /** Leave the viewer's own lists out (they're under Lists -> Mine). */
  excludeOwn?: boolean;
}

/**
 * Lists people on Afiyeat are building: search, Everyone / Friends, and
 * pages of cards. The same component is Explore -> Lists and
 * Lists -> Discover, so the two can never disagree.
 *
 * Search runs on the server against what each list is allowed to show -
 * its title, item names and types - so nothing private can match.
 */
export function CommunityListsBrowser({ initialQuery = '', excludeOwn = true }: CommunityListsBrowserProps) {
  const { user } = useAuth();
  const [mode, setMode] = useState<CommunityMode>('all');
  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery.trim());

  useEffect(() => setInput(initialQuery), [initialQuery]);
  useEffect(() => {
    const id = setTimeout(() => setQuery(input.trim()), 300);
    return () => clearTimeout(id);
  }, [input]);

  const { data, isLoading, isError, isFetchingNextPage, fetchNextPage, hasNextPage, refetch } = useInfiniteQuery({
    queryKey: ['community-lists', mode, query],
    queryFn: ({ pageParam }) => fetchCommunityLists({ mode, query, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset,
    enabled: !!user,
    staleTime: 60 * 1000,
  });

  const lists = useMemo(
    () =>
      uniqueLists((data?.pages ?? []).flatMap((p) => p.lists)).filter(
        (l) => !(excludeOwn && l.user_id && l.user_id === user?.id),
      ),
    [data, excludeOwn, user?.id],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            enterKeyHint="search"
            placeholder="Search lists by name or what's on them"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="pl-9"
            aria-label="Search community lists"
          />
        </div>
        <Tabs value={mode} onValueChange={(v) => setMode(v as CommunityMode)}>
          <TabsList>
            <TabsTrigger value="all">Everyone</TabsTrigger>
            <TabsTrigger value="friends">Friends</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Lists marked Anonymous are shared by members who keep their name private.</span>
      </p>

      {isLoading ? (
        <CardGridSkeleton />
      ) : isError ? (
        <div className="rounded-xl bg-card px-6 py-12 text-center">
          <p className="mb-3 text-muted-foreground">Couldn't load lists.</p>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : lists.length === 0 ? (
        <div className="rounded-xl bg-card px-6 py-16 text-center">
          <Compass className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
          <h3 className="mb-2 text-lg font-medium">{query ? 'No lists match' : 'Nothing to discover yet'}</h3>
          <p className="text-muted-foreground">
            {query
              ? 'Try another word - list names, items and types are searched.'
              : mode === 'friends'
                ? 'Lists made by people you follow will show up here.'
                : 'Lists people share with the community will show up here.'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
            {lists.map((list) => (
              <ExploreListCard key={communityListKey(list)} list={list} />
            ))}
          </div>
          {hasNextPage && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
                {isFetchingNextPage && <Spinner className="mr-2 h-4 w-4 animate-spin" />}
                Show more lists
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
