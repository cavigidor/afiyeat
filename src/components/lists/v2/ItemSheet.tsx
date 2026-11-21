import { useState } from 'react';
import { MapPin, Pencil, Trash2, StickyNote } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useSignedImageUrls } from '@/hooks/useSignedImageUrl';
import type { CustomList } from '@/components/lists/CreateListDialog';
import type { CustomListItem } from '@/components/lists/AddCustomListItemDialog';
import type { ManagedListType } from '@/hooks/useListTypeManagement';
import type { ManagedListStatus } from '@/hooks/useListStatusManagement';
import { formatPriceOf, formatRatingOf } from '@/lib/customListValues';
import { GetDirectionsButton } from '@/components/shared/GetDirectionsButton';
import { ItemThumb, RatingBadge } from './ListItems';
import { categoriesOf } from '@/lib/listItemDisplay';
import { cn } from '@/lib/utils';
import type { FieldDef } from '@/lib/presetFields';
import { formatValue, type ItemValues } from '@/lib/itemDetails';

interface ItemSheetProps {
  item: CustomListItem | null;
  list: CustomList;
  types: ManagedListType[];
  statuses: ManagedListStatus[];
  onClose: () => void;
  onEdit: (item: CustomListItem) => void;
  onDelete: (item: CustomListItem) => void;
  onMove: (item: CustomListItem, statusId: string) => Promise<boolean>;
  /** The list's preset fields and this item's values (owner-only). Only filled, shown fields appear. */
  fields?: FieldDef[] | null;
  values?: ItemValues;
}

/** One item, read at a glance, with the two things people do most: move it to another status, and edit it. */
export function ItemSheet({ item, list, types, statuses, onClose, onEdit, onDelete, onMove, fields, values }: ItemSheetProps) {
  const [moving, setMoving] = useState<string | null>(null);
  const photos = list.show_photos ? item?.images ?? [] : [];
  const { signedUrls } = useSignedImageUrls(photos.map((p) => p.image_url), 'custom-list-images');
  if (!item) return null;
  const cats = categoriesOf(item, types);
  const rating = formatRatingOf(item, list);
  const price = formatPriceOf(item, list);
  const details = (fields ?? []).filter((f) => !f.hidden)
    .map((f) => ({ key: f.key, label: f.label, text: formatValue(f, values?.[f.key]) }))
    .filter((d): d is { key: string; label: string; text: string } => !!d.text);

  const move = async (statusId: string) => {
    if (statusId === item.status_id || moving) return;
    setMoving(statusId);
    await onMove(item, statusId);
    setMoving(null);
  };

  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" showCloseButton={false} onOpenAutoFocus={(e) => e.preventDefault()} className="max-h-[90dvh] rounded-t-3xl px-4 pt-3 sm:mx-auto sm:max-w-lg">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted" aria-hidden />
        {photos.length > 0 && (
          <div className="-mx-4 mb-3 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 no-scrollbar">
            {photos.map((p, i) => (
              <span key={p.id} className={cn('block aspect-[4/3] shrink-0 snap-center overflow-hidden rounded-2xl bg-muted', photos.length > 1 ? 'w-[85%]' : 'w-full')}>
                {signedUrls[i] && <img src={signedUrls[i]!} alt="" className="h-full w-full object-cover" />}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-start gap-3">
          {photos.length === 0 && <ItemThumb item={item} list={list} types={types} size={52} />}
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-xl font-bold leading-tight [overflow-wrap:anywhere]">{item.name}</SheetTitle>
            <SheetDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              {rating && <RatingBadge value={rating} className="text-foreground" />}
              {price && <span>{price}</span>}
              {cats.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${c.color}22`, color: c.color }}>
                  {c.icon && <span aria-hidden>{c.icon}</span>}{c.name}
                </span>
              ))}
            </SheetDescription>
          </div>
        </div>

        {statuses.length > 0 && (
          <div role="group" aria-label="Status" className="mt-4 grid gap-1 rounded-2xl bg-muted p-1" style={{ gridTemplateColumns: `repeat(${Math.min(statuses.length, 3)}, minmax(0, 1fr))` }}>
            {statuses.map((s) => (
              <button key={s.id} type="button" aria-pressed={s.id === item.status_id} onClick={() => void move(s.id)}
                className={cn('flex min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-sm font-medium transition-all active-press', s.id === item.status_id ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
                {moving === s.id && <Spinner className="h-3.5 w-3.5 animate-spin" />}
                <span className="truncate">{s.name}</span>
              </button>
            ))}
          </div>
        )}

        {details.length > 0 && (
          <dl className="mt-4 divide-y rounded-2xl border bg-card text-sm" aria-label="Details">
            {details.map((d) => (
              <div key={d.key} className="flex gap-3 px-3 py-2.5">
                <dt className="w-28 shrink-0 text-muted-foreground">{d.label}</dt>
                <dd className="min-w-0 flex-1 [overflow-wrap:anywhere]">{d.text}</dd>
              </div>
            ))}
          </dl>
        )}

        {list.show_location && item.address && (
          <div className="mt-4 flex items-center gap-3 rounded-2xl border bg-card p-3">
            <MapPin className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{item.address}</span>
            {item.latitude != null && item.longitude != null && (
              <GetDirectionsButton latitude={item.latitude} longitude={item.longitude} name={item.name} address={item.address} />
            )}
          </div>
        )}
        {list.show_notes && item.notes && (
          <div className="mt-3 flex gap-3 rounded-2xl border bg-card p-3 text-sm">
            <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{item.notes}</p>
          </div>
        )}

        <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
          <Button className="h-12 rounded-xl text-base" onClick={() => onEdit(item)}>
            <Pencil className="mr-2 h-4 w-4" />Edit details
          </Button>
          <Button variant="outline" className="h-12 w-12 rounded-xl p-0 text-destructive" aria-label={`Delete ${item.name}`} onClick={() => onDelete(item)}>
            <Trash2 className="h-5 w-5" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
