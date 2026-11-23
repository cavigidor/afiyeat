import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { DiscoverySection, Rail } from '@/components/discovery/DiscoverySection';
import { EventTile, TileSkeleton } from '@/components/discovery/DiscoveryTiles';
import { fetchNearbyEvents } from '@/lib/events';
import type { Origin } from '@/lib/discovery';

const RADIUS_MILES = 25;

/**
 * Ticketmaster events in the next seven days near you. Home never asks
 * for location, so without it this is a single row pointing to Events in
 * Explore, which asks in context when opened.
 */
export function HappeningSoonSection({ origin, locationKnown }: { origin: Origin | null; locationKnown: boolean }) {
  const key = origin ? `${origin.lat.toFixed(2)},${origin.lng.toFixed(2)}` : null;
  const { data: events = [], isLoading, isError } = useQuery({
    queryKey: ['explore-events', key, RADIUS_MILES, '', 'week'],
    queryFn: () => fetchNearbyEvents(origin!.lat, origin!.lng, '', 'week', RADIUS_MILES),
    enabled: !!origin,
    staleTime: 10 * 60 * 1000,
  });

  // Still finding out whether location is allowed.
  if (!locationKnown) return null;

  if (!origin) {
    return (
      <Link
        to="/explore?c=events"
        className="active-press flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm transition-[background-color,transform] duration-150 ease-out active:bg-muted/60"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/25 text-xl">
          🎟️
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium leading-snug">What's on near you</span>
          <span className="block text-sm text-muted-foreground">Concerts, games and shows this week</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      </Link>
    );
  }

  if (isLoading) {
    return (
      <DiscoverySection title="Happening this week">
        <Rail>
          {[0, 1].map((i) => (
            <TileSkeleton key={i} wide />
          ))}
        </Rail>
      </DiscoverySection>
    );
  }

  const upcoming = events.filter((e) => !e.isCancelled).slice(0, 8);
  if (isError || upcoming.length === 0) return null;

  return (
    <DiscoverySection
      title="Happening this week"
      subtitle="Events near you, from Ticketmaster"
      seeAllTo="/explore?c=events"
    >
      <Rail>
        {upcoming.map((event) => (
          <EventTile key={event.id} event={event} />
        ))}
      </Rail>
    </DiscoverySection>
  );
}
