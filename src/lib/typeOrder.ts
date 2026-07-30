// Canonical display order for restaurant "type"/folder names, wherever
// they're listed (Type dropdown in Add/Edit Restaurant, the Types sidebar,
// the type filter dropdown). Names not in this list are unknown/custom
// types the user created themselves - those sort alphabetically after all
// known ones, rather than being scattered based on when they were created.
const TYPE_ORDER = [
  'Lunch',
  'Dinner',
  'Breakfast',
  'Brunch',
  'Bakery',
  'Cafe',
  'Coffee',
  'Bar',
  'Sushi',
  'Pizza',
  'Burger',
  'Mexican',
  'Steakhouse',
  'Seafood',
  'Restaurant',
];

function typeSortIndex(name: string): number {
  const idx = TYPE_ORDER.findIndex((t) => t.toLowerCase() === name.toLowerCase());
  return idx === -1 ? TYPE_ORDER.length : idx;
}

export function compareTypeNames(a: string, b: string): number {
  const ia = typeSortIndex(a);
  const ib = typeSortIndex(b);
  if (ia !== ib) return ia - ib;
  return a.localeCompare(b);
}
