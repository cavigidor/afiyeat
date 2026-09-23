import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MapPin } from 'lucide-react';
import { JoinAfiyeatCta, OwnerByline, SharedNotAvailable } from './SharedContentBits';
import { fetchListPreview } from '@/lib/sharedPreview';

/**
 * What someone without an account sees when a friend shares a list: the
 * list's name and the places on it, then an invitation to join.
 *
 * Used to be a redirect straight to the login screen, which meant the
 * person a list was shared with never saw a single place on it.
 */
export function SharedListPreview({ listId }: { listId: string }) {
  const { data: list, isLoading } = useQuery({
    queryKey: ['shared-list-preview', listId],
    queryFn: () => fetchListPreview(listId),
    staleTime: 60 * 1000,
  });

  const hiddenCount = list ? Math.max(0, list.item_count - list.items.length) : 0;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container py-4 sm:py-8 px-4 sm:px-6 lg:px-8 max-w-2xl space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-2/3" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : !list ? (
          <SharedNotAvailable what="list" />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div
                className="w-11 h-11 rounded-lg flex items-center justify-center text-xl shrink-0"
                style={{ backgroundColor: `${list.color ?? '#999999'}22` }}
              >
                {list.icon}
              </div>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold truncate">{list.name}</h1>
                <p className="text-xs text-muted-foreground">
                  {list.item_count} place{list.item_count === 1 ? '' : 's'}
                </p>
              </div>
            </div>

            <OwnerByline owner={list.owner} verb="A list by" linkToProfile={false} />

            {list.items.length > 0 ? (
              <Card>
                <CardContent className="p-0 divide-y">
                  {list.items.map((item, i) => (
                    <div key={i} className="p-4">
                      <p className="font-medium">{item.name}</p>
                      {item.address && (
                        <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5 min-w-0">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{item.address}</span>
                        </p>
                      )}
                    </div>
                  ))}
                  {hiddenCount > 0 && (
                    <p className="p-4 text-sm text-muted-foreground">
                      and {hiddenCount} more — join to see the whole list
                    </p>
                  )}
                </CardContent>
              </Card>
            ) : (
              <p className="text-sm text-muted-foreground">This list doesn't have any places yet.</p>
            )}

            <JoinAfiyeatCta owner={list.owner} what="this list" />
          </>
        )}
      </main>
    </div>
  );
}
