import { useMemo } from 'react';
import { EyeOff, Star } from 'lucide-react';
import type { DiscoverableList } from '@/lib/communityLists';

function formatRating(rating: number | null, mode: DiscoverableList['rating_mode']): string | null {
  if (rating == null || mode == null) return null;
  if (mode === 'stars_5') return `${rating}/5`;
  if (mode === 'scale_10') return `${rating}/10`;
  return String(rating);
}

/**
 * The anonymous view of a list, as everyone except its owner sees it.
 * Everything on this screen comes from get_discoverable_list, which only
 * ever returns the list's name and icon, item names, statuses, types and
 * ratings - there is no owner, note, photo or location to show.
 */
export function DiscoverableListView({ list, compact = false }: { list: DiscoverableList; compact?: boolean }) {
  const typeIcon = useMemo(() => new Map(list.types.map((t) => [t.name, t.icon])), [list.types]);
  // Group by status, in the list's own order; items without one go last.
  const groups = useMemo(() => {
    const order = [...list.statuses, null];
    return order
      .map((status) => ({ status, items: list.items.filter((i) => (i.status ?? null) === status) }))
      .filter((g) => g.items.length > 0);
  }, [list]);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-muted text-3xl" aria-hidden>
          {list.icon || '📋'}
        </span>
        <div className="min-w-0">
          {compact ? (
            <p className="text-lg font-bold leading-tight break-words">{list.title}</p>
          ) : (
            <h1 className="text-xl sm:text-2xl font-bold leading-tight break-words">{list.title}</h1>
          )}
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <EyeOff className="h-4 w-4 shrink-0" />
            Shared anonymously by an Afiyeat member · {list.items.length} item{list.items.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {list.types.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Types">
          {list.types.map((t) => (
            <span key={t.name} className="rounded-full border bg-card px-2.5 py-1 text-xs">
              {t.icon ? `${t.icon} ` : ''}
              {t.name}
            </span>
          ))}
        </div>
      )}

      {list.items.length === 0 ? (
        <p className="rounded-xl bg-card px-6 py-10 text-center text-muted-foreground">Nothing on this list yet.</p>
      ) : (
        groups.map((g) => (
          <section key={g.status ?? '__none'} className="space-y-2">
            {list.statuses.length > 0 && (
              <h2 className="text-sm font-semibold text-muted-foreground">
                {g.status ?? 'Other'} <span className="font-normal">· {g.items.length}</span>
              </h2>
            )}
            <ul className="divide-y rounded-2xl border bg-card">
              {g.items.map((item, i) => {
                const rating = formatRating(item.rating, list.rating_mode);
                return (
                  <li key={`${item.name}-${i}`} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium break-words">{item.name}</p>
                      {item.types.length > 0 && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {item.types.map((t) => `${typeIcon.get(t) ?? ''} ${t}`.trim()).join(' · ')}
                        </p>
                      )}
                    </div>
                    {rating && (
                      <span className="flex shrink-0 items-center gap-1 text-sm">
                        <Star className="h-3.5 w-3.5 fill-accent text-accent" />
                        {rating}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
