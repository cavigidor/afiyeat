/**
 * Canonical display order for restaurant types (folders).
 * Anything not listed sorts after, alphabetically.
 */
export const TYPE_ORDER = [
  'Lunch/Dinner',
  'Bakery',
  'Cafe',
  'Bar',
  'Brunch',
];

export function typeRank(name?: string | null): number {
  if (!name) return TYPE_ORDER.length;
  const idx = TYPE_ORDER.findIndex((t) => t.toLowerCase() === name.toLowerCase());
  return idx === -1 ? TYPE_ORDER.length : idx;
}

export function compareTypeNames(a?: string | null, b?: string | null): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  return (a ?? '').localeCompare(b ?? '');
}

export function sortByTypeOrder<T>(items: T[], getName: (item: T) => string | null | undefined): T[] {
  return [...items].sort((a, b) => compareTypeNames(getName(a), getName(b)));
}
