import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { AnimalAvatar } from '@/components/shared/AnimalAvatar';
import { Button } from '@/components/ui/button';
import { DiscoverySection } from '@/components/discovery/DiscoverySection';
import { actorName, fetchCircleActivity, timeAgo, type CircleEvent } from '@/lib/circle';
import { emojiForPlace } from '@/lib/discovery';

function eventLine(e: CircleEvent) {
  if (e.kind === 'list') {
    return (
      <>
        started a list <span className="font-semibold text-foreground">{e.listName}</span>
      </>
    );
  }
  if (e.status === 'went_to') {
    return (
      <>
        went to <span className="font-semibold text-foreground">{e.placeName}</span>
        {e.rating != null && <span className="text-muted-foreground"> · {e.rating}/10</span>}
      </>
    );
  }
  return (
    <>
      wants to try <span className="font-semibold text-foreground">{e.placeName}</span>
    </>
  );
}

function eventHref(e: CircleEvent): string {
  return e.kind === 'list' ? `/u/${e.actor.user_id}/lists/${e.listId}` : `/u/${e.actor.user_id}`;
}

/**
 * What people you follow have been saving lately - places they want to
 * try or have been to, lists they've started. Only events that help you
 * find something; nothing about who followed whom.
 */
export function CircleSection() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['home-circle', user?.id],
    queryFn: () => fetchCircleActivity(user!.id),
    enabled: !!user,
  });

  if (isLoading || !data) return null;

  // Follows nobody yet: this section's one job is to fix that.
  if (data.followingCount === 0) {
    return (
      <DiscoverySection title="From your circle">
        <div className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-sm">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserPlus className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-snug">See where your friends go</p>
            <p className="text-sm text-muted-foreground">Follow people to see what they save here.</p>
          </div>
          <Button asChild size="sm" className="shrink-0">
            <Link to="/friends">Find people</Link>
          </Button>
        </div>
      </DiscoverySection>
    );
  }

  // Following people, but nothing new from them this month - leave the
  // section out rather than fill it with an empty box.
  if (data.events.length === 0) return null;

  return (
    <DiscoverySection title="From your circle" subtitle="What people you follow saved lately">
      <ul className="divide-y rounded-2xl border bg-card shadow-sm">
        {data.events.map((e) => (
          <li key={e.id}>
            <Link
              to={eventHref(e)}
              className="active-press flex items-center gap-3 px-4 py-3 transition-[background-color,transform] duration-150 ease-out active:bg-muted/60"
            >
              <AnimalAvatar emoji={e.actor.avatar_emoji} color={e.actor.avatar_color} className="h-9 w-9" />
              <p className="min-w-0 flex-1 text-sm text-muted-foreground leading-snug">
                <span className="font-medium text-foreground">{actorName(e.actor)}</span> {eventLine(e)}
              </p>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span aria-hidden className="text-lg leading-none">
                  {e.kind === 'list' ? e.listIcon || '📋' : emojiForPlace(e.category)}
                </span>
                <span className="text-[11px] text-muted-foreground">{timeAgo(e.at)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </DiscoverySection>
  );
}
