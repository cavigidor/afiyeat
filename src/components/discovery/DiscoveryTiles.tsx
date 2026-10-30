import { Link } from 'react-router-dom';
import { Plus, Star, Users, ListChecks, CalendarDays, EyeOff } from 'lucide-react';
import { AnimalAvatar } from '@/components/shared/AnimalAvatar';
import { toNumber, type ExplorePlace } from '@/components/explore/ExplorePlaceCard';
import type { ExploreList } from '@/components/explore/ExploreListCard';
import type { TicketmasterEvent } from '@/components/explore/EventCard';
import { areaFromAddress, emojiForPlace, placeCategoryOf } from '@/lib/discovery';
import { formatEventDate, formatEventTime } from '@/lib/events';
import { openExternalUrl } from '@/lib/externalLink';
import { communityListPath } from '@/lib/communityLists';
import { cn } from '@/lib/utils';

// Compact cards for horizontal rails. Saved places have no photos we can
// show (restaurant photos are private to their owner), so a place gets a
// tinted tile with its category's emoji - the same visual language as the
// app's list icons, rather than a grey "no image" box.

const PLACE_TINT: Record<string, string> = {
  food: 'bg-primary/10',
  coffee: 'bg-accent/25',
  drinks: 'bg-secondary/10',
};

interface PlaceTileProps {
  place: ExplorePlace;
  onOpen: () => void;
  onSave?: () => void;
}

export function PlaceTile({ place, onOpen, onSave }: PlaceTileProps) {
  const rating = toNumber(place.avg_rating);
  const people = toNumber(place.contributor_count) ?? 0;
  const area = areaFromAddress(place.address);
  const tint = PLACE_TINT[placeCategoryOf(place.category)];

  return (
    <div className="relative w-40">
      <button
        type="button"
        onClick={onOpen}
        className="active-press block w-full text-left transition-transform duration-150 ease-out"
      >
        <div className={cn('flex aspect-[4/3] items-center justify-center rounded-2xl text-4xl', tint)}>
          <span aria-hidden>{emojiForPlace(place.category)}</span>
        </div>
        <p className="mt-2 truncate text-sm font-semibold">{place.name}</p>
        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          {rating != null && (
            <>
              <Star className="h-3 w-3 shrink-0 fill-accent text-accent" />
              <span className="text-foreground/80">{rating.toFixed(1)}</span>
              <span aria-hidden>·</span>
            </>
          )}
          <Users className="h-3 w-3 shrink-0" />
          <span>{people}</span>
          {area && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{area}</span>
            </>
          )}
        </p>
      </button>
      {onSave && (
        <button
          type="button"
          onClick={onSave}
          aria-label={`Save ${place.name} to a list`}
          className="active-press absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-card/95 text-foreground shadow-sm transition-transform duration-150 ease-out"
        >
          <Plus className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function ListTile({ list }: { list: ExploreList }) {
  const count = toNumber(list.item_count) ?? 0;
  const owner = list.display_name || list.username;
  const path = communityListPath(list);
  if (!path) return null;
  return (
    <Link
      to={path}
      className="active-press flex w-56 flex-col justify-between gap-4 rounded-2xl border bg-card p-4 shadow-sm transition-[transform,background-color] duration-150 ease-out active:bg-muted/60"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-2xl">
          {list.list_icon || <ListChecks className="h-5 w-5 text-muted-foreground" />}
        </span>
        <div className="min-w-0">
          <p className="line-clamp-2 font-semibold leading-snug">{list.list_name}</p>
          <p className="text-xs text-muted-foreground">
            {count} item{count === 1 ? '' : 's'}
          </p>
        </div>
      </div>
      {list.is_anonymous ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <EyeOff className="h-3.5 w-3.5" />
          <span>Shared anonymously</span>
        </div>
      ) : (
        owner && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AnimalAvatar
              emoji={list.avatar_emoji}
              color={list.avatar_color}
              className="h-5 w-5"
              emojiClassName="text-[11px]"
            />
            <span className="truncate">by {owner}</span>
          </div>
        )
      )}
    </Link>
  );
}

export function EventTile({ event }: { event: TicketmasterEvent }) {
  const date = formatEventDate(event.localDate);
  const time = formatEventTime(event.localTime);
  return (
    <button
      type="button"
      onClick={() => openExternalUrl(event.url)}
      className="active-press block w-56 text-left transition-transform duration-150 ease-out"
    >
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-muted">
        {event.imageUrl ? (
          <img src={event.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <CalendarDays className="h-8 w-8 text-muted-foreground/60" />
          </div>
        )}
        {date && (
          <span className="absolute left-2 top-2 rounded-full bg-card/95 px-2 py-0.5 text-[11px] font-semibold shadow-sm">
            {date}
          </span>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-semibold leading-snug">{event.name}</p>
      <p className="truncate text-xs text-muted-foreground">
        {[time, event.venueName].filter(Boolean).join(' · ')}
      </p>
    </button>
  );
}

/** Same footprint as a tile, shown while a rail loads. */
export function TileSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className={wide ? 'w-56' : 'w-40'} aria-hidden>
      <div className={cn('rounded-2xl bg-muted animate-pulse', wide ? 'aspect-video' : 'aspect-[4/3]')} />
      <div className="mt-2 h-3.5 w-3/4 rounded bg-muted animate-pulse" />
      <div className="mt-1.5 h-3 w-1/2 rounded bg-muted/70 animate-pulse" />
    </div>
  );
}
