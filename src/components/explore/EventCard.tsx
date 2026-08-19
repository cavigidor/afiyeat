import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarDays, MapPin, Ticket, ExternalLink } from 'lucide-react';
import { openExternalUrl } from '@/lib/externalLink';

export interface TicketmasterEvent {
  id: string;
  name: string;
  url: string;
  imageUrl: string | null;
  startDateTime: string | null;
  localDate: string | null;
  localTime: string | null;
  isCancelled: boolean;
  category: string | null;
  genre: string | null;
  venueName: string | null;
  venueAddress: string | null;
  venueCity: string | null;
  latitude: number | null;
  longitude: number | null;
  priceMin: number | null;
  priceMax: number | null;
  priceCurrency: string | null;
}

// Ticketmaster gives date and time as separate venue-local strings rather
// than a single instant - building Date objects from just the numeric
// parts (not a combined ISO string) means we display the wall-clock time
// Ticketmaster gave us as-is, instead of accidentally shifting it by the
// viewer's own device timezone.
function formatEventDate(localDate: string | null): string | null {
  if (!localDate) return null;
  const [y, m, d] = localDate.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatEventTime(localTime: string | null): string | null {
  if (!localTime) return null;
  const [h, min] = localTime.split(':').map(Number);
  if (h == null || min == null) return null;
  const d = new Date();
  d.setHours(h, min, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatPrice(event: TicketmasterEvent): string | null {
  if (event.priceMin == null) return null;
  const symbol = event.priceCurrency === 'USD' || !event.priceCurrency ? '$' : `${event.priceCurrency} `;
  if (event.priceMax != null && event.priceMax !== event.priceMin) {
    return `${symbol}${event.priceMin}-${event.priceMax}`;
  }
  return `From ${symbol}${event.priceMin}`;
}

interface EventCardProps {
  event: TicketmasterEvent;
}

export function EventCard({ event }: EventCardProps) {
  const dateLabel = formatEventDate(event.localDate);
  const timeLabel = formatEventTime(event.localTime);
  const priceLabel = formatPrice(event);

  return (
    <Card
      className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow group"
      onClick={() => openExternalUrl(event.url)}
      role="button"
      tabIndex={0}
    >
      {event.imageUrl && (
        <div className="relative aspect-video bg-muted">
          <img
            src={event.imageUrl}
            alt={event.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          {event.isCancelled && (
            <Badge variant="destructive" className="absolute top-2 right-2">
              Cancelled
            </Badge>
          )}
        </div>
      )}

      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold leading-snug line-clamp-2 group-hover:text-primary transition-colors">
            {event.name}
          </h3>
          {event.category && (
            <Badge variant="secondary" className="shrink-0">
              {event.category}
            </Badge>
          )}
        </div>

        {(dateLabel || timeLabel) && (
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            {dateLabel}
            {timeLabel ? ` · ${timeLabel}` : ''}
          </p>
        )}

        {event.venueName && (
          <p className="text-sm text-muted-foreground flex items-center gap-1.5 truncate">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {event.venueName}
              {event.venueCity ? `, ${event.venueCity}` : ''}
            </span>
          </p>
        )}

        <div className="flex items-center justify-between pt-1">
          {priceLabel ? (
            <span className="text-sm font-medium flex items-center gap-1">
              <Ticket className="h-3.5 w-3.5" />
              {priceLabel}
            </span>
          ) : (
            <span />
          )}
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            Tickets <ExternalLink className="h-3 w-3" />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
