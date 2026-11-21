import { memo } from 'react';
import { Star, MapPin } from 'lucide-react';
import { useSignedImageUrl } from '@/hooks/useSignedImageUrl';
import type { CustomList } from '@/components/lists/CreateListDialog';
import type { CustomListItem } from '@/components/lists/AddCustomListItemDialog';
import type { ManagedListType } from '@/hooks/useListTypeManagement';
import { formatPriceOf, formatRatingOf } from '@/lib/customListValues';
import { categoriesOf, subtitleOf } from '@/lib/listItemDisplay';
import { ListGlyph } from './ListGlyph';
import { cn } from '@/lib/utils';

const BUCKET = 'custom-list-images' as const;

export function ItemThumb({ item, list, types, size = 44, className }: {
  item: CustomListItem; list: CustomList; types: ManagedListType[]; size?: number; className?: string;
}) {
  const url = list.show_photos ? item.images?.[0]?.image_url : undefined;
  const { signedUrl } = useSignedImageUrl(url, BUCKET);
  const first = categoriesOf(item, types)[0];
  const style = { width: size, height: size };
  if (url && signedUrl) {
    return <img src={signedUrl} alt="" style={style} className={cn('shrink-0 rounded-xl object-cover bg-muted', className)} loading="lazy" />;
  }
  if (url) return <span style={style} className={cn('shrink-0 rounded-xl bg-muted animate-pulse', className)} aria-hidden />;
  if (first?.icon) {
    return (
      <span aria-hidden style={{ ...style, backgroundColor: `${first.color}22` }} className={cn('inline-flex shrink-0 items-center justify-center rounded-xl text-lg', className)}>
        {first.icon}
      </span>
    );
  }
  return <ListGlyph icon={list.icon} color={list.color} size="md" className={cn('rounded-xl', className)} />;
}

export function RatingBadge({ value, className }: { value: string | null; className?: string }) {
  if (!value) return null;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 font-semibold tabular-nums', className)}>
      <Star className="h-4 w-4 fill-amber-400 text-amber-500" aria-hidden />
      <span><span className="sr-only">Rated </span>{value}</span>
    </span>
  );
}

export const ItemRow = memo(function ItemRow({ item, list, types, onOpen, detail }: {
  item: CustomListItem; list: CustomList; types: ManagedListType[]; onOpen: () => void;
  /** A short line from the item's preset fields, e.g. "Tide Roasters · Light"; goes first. */
  detail?: string;
}) {
  const subtitle = [detail, subtitleOf(item, list, types)].filter(Boolean).join(' · ');
  return (
    <button type="button" onClick={onOpen} className="flex w-full min-w-0 items-center gap-3 px-1 py-2.5 text-left transition-colors hover:bg-muted/40 active-press">
      <ItemThumb item={item} list={list} types={types} />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold leading-snug line-clamp-2 [overflow-wrap:anywhere]">{item.name}</span>
        {subtitle && <span className="mt-0.5 block truncate text-sm text-muted-foreground">{subtitle}</span>}
      </span>
      <RatingBadge value={formatRatingOf(item, list)} />
    </button>
  );
});

export const ItemCard = memo(function ItemCard({ item, list, types, onOpen }: {
  item: CustomListItem; list: CustomList; types: ManagedListType[]; onOpen: () => void;
}) {
  const url = item.images?.[0]?.image_url;
  const { signedUrl } = useSignedImageUrl(url, BUCKET);
  const cats = categoriesOf(item, types);
  const rating = formatRatingOf(item, list);
  return (
    <button type="button" onClick={onOpen} className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-sm active-press">
      <span className="relative block aspect-square w-full bg-muted">
        {signedUrl ? (
          <img src={signedUrl} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" loading="lazy" />
        ) : (
          <span className="flex h-full w-full items-center justify-center"><ItemThumb item={{ ...item, images: [] }} list={list} types={types} size={56} /></span>
        )}
        {rating && (
          <span className="absolute right-2 top-2 rounded-full bg-background/90 px-2 py-0.5 text-sm shadow-sm backdrop-blur"><RatingBadge value={rating} className="text-sm" /></span>
        )}
      </span>
      <span className="block p-2.5">
        <span className="block text-sm font-semibold leading-snug line-clamp-2 [overflow-wrap:anywhere]">{item.name}</span>
        {(cats[0] || (list.show_location && item.address)) && (
          <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
            {cats[0] ? cats[0].name : <><MapPin className="h-3 w-3 shrink-0" />{item.address?.split(',')[0]}</>}
          </span>
        )}
      </span>
    </button>
  );
});

