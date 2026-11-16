import type { CustomList } from '@/components/lists/CreateListDialog';
import type { CustomListItem } from '@/components/lists/AddCustomListItemDialog';

// Price and rating each have two possible storage columns depending on the
// list's chosen entry mode (structured vs. manual) - these pick the right
// one so sorting/comparison logic only has to live in one place.

export function getPriceSortValue(item: CustomListItem, list: CustomList): number | null {
  if (!list.show_price) return null;
  return list.price_mode === 'manual' ? item.price_manual ?? null : item.price_level ?? null;
}

export function getRatingSortValue(item: CustomListItem, list: CustomList): number | null {
  if (!list.show_rating) return null;
  return list.rating_mode === 'manual' ? item.rating_manual ?? null : item.rating ?? null;
}

/** "$$" or "$48", only when the list shows price and the item has one. */
export function formatPriceOf(item: CustomListItem, list: CustomList): string | null {
  if (!list.show_price) return null;
  if (list.price_mode === 'dollar') return item.price_level ? '$'.repeat(item.price_level) : null;
  return item.price_manual != null ? `$${Number(item.price_manual).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : null;
}

/** The rating as shown on a row ("9", "4/5", "B+"), only when the list shows ratings and the item has one. */
export function formatRatingOf(item: CustomListItem, list: CustomList): string | null {
  if (!list.show_rating) return null;
  if (list.rating_mode === 'scale_10') return item.rating != null ? String(item.rating) : null;
  if (list.rating_mode === 'stars_5') return item.rating != null ? `${item.rating}/5` : null;
  return item.rating_manual != null ? String(item.rating_manual) : null;
}
