import { supabase } from '@/integrations/supabase/client';
import type { TicketmasterEvent } from '@/components/explore/EventCard';

export type EventsDateFilter = 'all' | 'today' | 'week' | 'month';

// Ticketmaster wants a UTC window, not a filter keyword - so "Today" /
// "This Week" / "This Month" are translated into startDateTime/endDateTime
// here and sent to the edge function, rather than filtered client-side out
// of the (size-capped) results already fetched.
function getEventsDateRange(filter: EventsDateFilter): { startDateTime?: string; endDateTime?: string } {
  if (filter === 'all') return {};
  const now = new Date();
  const end = new Date(now);
  if (filter === 'today') {
    end.setHours(23, 59, 59, 999);
  } else if (filter === 'week') {
    end.setDate(end.getDate() + 7);
  } else {
    end.setDate(end.getDate() + 30);
  }
  return { startDateTime: now.toISOString(), endDateTime: end.toISOString() };
}

/** Events near a point, through the search-events edge function (Ticketmaster). */
export async function fetchNearbyEvents(
  latitude: number,
  longitude: number,
  keyword: string,
  dateFilter: EventsDateFilter,
  radiusMiles: number,
): Promise<TicketmasterEvent[]> {
  const { startDateTime, endDateTime } = getEventsDateRange(dateFilter);
  const { data, error } = await supabase.functions.invoke('search-events', {
    body: {
      latitude,
      longitude,
      keyword: keyword || undefined,
      startDateTime,
      endDateTime,
      radiusMiles,
    },
  });
  if (error) throw error;
  return (data?.events || []) as TicketmasterEvent[];
}

// Ticketmaster gives date and time as separate venue-local strings rather
// than a single instant - building Date objects from just the numeric
// parts (not a combined ISO string) means we display the wall-clock time
// Ticketmaster gave us as-is, instead of accidentally shifting it by the
// viewer's own device timezone.
export function formatEventDate(localDate: string | null): string | null {
  if (!localDate) return null;
  const [y, m, d] = localDate.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatEventTime(localTime: string | null): string | null {
  if (!localTime) return null;
  const [h, min] = localTime.split(':').map(Number);
  if (h == null || min == null) return null;
  const d = new Date();
  d.setHours(h, min, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
