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
