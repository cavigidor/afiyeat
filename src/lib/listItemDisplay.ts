import type { CustomList } from '@/components/lists/CreateListDialog';
import type { CustomListItem } from '@/components/lists/AddCustomListItemDialog';
import type { ManagedListType } from '@/hooks/useListTypeManagement';
import { formatPriceOf } from '@/lib/customListValues';

/** The item's categories in the list's category order. */
export function categoriesOf(item: CustomListItem, types: ManagedListType[]): ManagedListType[] {
  const ids = item.type_ids?.length ? item.type_ids : item.type_id ? [item.type_id] : [];
  return types.filter((t) => ids.includes(t.id));
}

/** First line under the name: categories, price, place. Only what the item actually has. */
export function subtitleOf(item: CustomListItem, list: CustomList, types: ManagedListType[]): string {
  const parts: string[] = [];
  const cats = categoriesOf(item, types).map((t) => t.name);
  if (cats.length) parts.push(cats.join(', '));
  const price = formatPriceOf(item, list);
  if (price) parts.push(price);
  if (list.show_location && item.address) parts.push(item.address.split(',')[0]);
  return parts.join(' · ');
}

export interface ItemGroup { key: string; title: string; items: CustomListItem[] }

/** Sections by category, in the list's category order; items with none go last. */
export function groupByCategory(items: CustomListItem[], types: ManagedListType[], ungroupedTitle: string): ItemGroup[] {
  const groups: ItemGroup[] = types.map((t) => ({ key: t.id, title: t.name, items: items.filter((i) => categoriesOf(i, [t]).length) }));
  const none = items.filter((i) => categoriesOf(i, types).length === 0);
  return [...groups.filter((g) => g.items.length), ...(none.length ? [{ key: 'none', title: ungroupedTitle, items: none }] : [])];
}
