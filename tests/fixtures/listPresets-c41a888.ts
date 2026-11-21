// Frozen copy of src/lib/listPresets.ts at c41a888 (the release candidate), used only to prove the
// Movies / Coffee Shops move left both presets unchanged. Do not edit.
// Lists V2: ready-to-use list presets, and how any list (new or old) is laid out.
//
// No database change: a preset is applied when the list is created, using columns that already
// exist (custom_lists.show_* / price_mode / rating_mode / icon / color / visibility, plus seeded
// custom_list_statuses and custom_list_types). Nothing records "which preset" afterwards, so a list's
// layout is read back from what it actually has: its icon when that is a known preset icon, and
// otherwise its own field settings. That is also how lists made before V2 get a fitting layout
// without being converted or rewritten.
import type { CustomList, PriceMode, RatingMode } from '@/components/lists/CreateListDialog';
import type { ListVisibility } from '@/lib/listVisibility';

export type LayoutKind = 'places' | 'tasting' | 'travel' | 'collection';
export type ListView = 'list' | 'cards' | 'grouped' | 'map';

export interface ListPresetDef {
  key: string;
  label: string;
  /** Under the label in the picker. */
  hint: string;
  /** Stored in custom_lists.icon (an emoji, as every list has always had). */
  icon: string;
  color: string;
  suggestedName: string;
  layout: LayoutKind;
  /** What one item is called: "Add a drink", "12 places". */
  itemNoun: { one: string; many: string };
  /** Placeholder of the quick-add bar. */
  addPrompt: string;
  config: {
    show_location: boolean; show_price: boolean; price_mode: PriceMode;
    show_rating: boolean; rating_mode: RatingMode; show_notes: boolean; show_photos: boolean;
  };
  statuses: string[];
  categories: { name: string; color: string; icon?: string }[];
  /** Only when it differs from today's default ('profile'). Travel starts as Only me. */
  visibility?: ListVisibility;
  defaultView: ListView;
  /** One line under the name in the create step. */
  summary: string;
}

const PLACE = { show_location: true, show_notes: true, show_photos: true } as const;

export const V2_PRESETS: ListPresetDef[] = [
  {
    key: 'restaurants', label: 'Restaurants', hint: 'Places to eat', icon: '🍽️', color: '#D2452B',
    suggestedName: 'Restaurants to try', layout: 'places', itemNoun: { one: 'place', many: 'places' }, addPrompt: 'Search a restaurant',
    config: { ...PLACE, show_price: true, price_mode: 'dollar', show_rating: true, rating_mode: 'scale_10' },
    statuses: ['Want to Go', 'Been'], categories: [], defaultView: 'list',
    summary: 'Want to Go · Been · map and price',
  },
  {
    key: 'drinks', label: 'Drinks', hint: 'Beer, wine, more', icon: '🍸', color: '#7B4FA0',
    suggestedName: 'Drinks', layout: 'tasting', itemNoun: { one: 'drink', many: 'drinks' }, addPrompt: 'Add a drink',
    config: { show_location: false, show_price: true, price_mode: 'manual', show_rating: true, rating_mode: 'scale_10', show_notes: true, show_photos: true },
    statuses: ['Want to Try', 'Tried'],
    categories: [
      { name: 'Beer', color: '#C9962B', icon: '🍺' }, { name: 'Wine', color: '#8E2430', icon: '🍷' },
      { name: 'Cocktails', color: '#2E86AB', icon: '🍸' }, { name: 'Spirits', color: '#9A5B2E', icon: '🥃' },
      { name: 'Non-alcoholic', color: '#4C9A5B', icon: '🧃' },
    ],
    defaultView: 'list', summary: 'Want to Try · Tried · Beer, Wine, Cocktails, Spirits',
  },
  {
    key: 'coffee_beans', label: 'Coffee Beans', hint: 'Bags you buy', icon: '🫘', color: '#7A4E2D',
    suggestedName: 'Coffee Beans', layout: 'tasting', itemNoun: { one: 'coffee', many: 'coffees' }, addPrompt: 'Add a coffee',
    config: { show_location: false, show_price: true, price_mode: 'manual', show_rating: true, rating_mode: 'scale_10', show_notes: true, show_photos: true },
    statuses: ['Want to Try', 'Tried'],
    categories: [
      { name: 'Light roast', color: '#C99A62' }, { name: 'Medium roast', color: '#9A5B2E' }, { name: 'Dark roast', color: '#4E342E' },
    ],
    defaultView: 'list', summary: 'Want to Try · Tried · light, medium, dark roast',
  },
  {
    key: 'coffee_shops', label: 'Coffee Shops', hint: 'Cafés to visit', icon: '☕', color: '#8D6E63',
    suggestedName: 'Coffee Shops', layout: 'places', itemNoun: { one: 'café', many: 'cafés' }, addPrompt: 'Search a café',
    config: { ...PLACE, show_price: true, price_mode: 'dollar', show_rating: true, rating_mode: 'scale_10' },
    statuses: ['Want to Go', 'Been'], categories: [], defaultView: 'list',
    summary: 'Want to Go · Been · map and price',
  },
  {
    key: 'stores', label: 'Stores', hint: 'Shops, wishlists', icon: '🛍️', color: '#1F7A80',
    suggestedName: 'Shops I love', layout: 'places', itemNoun: { one: 'place', many: 'places' }, addPrompt: 'Search a store',
    config: { ...PLACE, show_price: true, price_mode: 'dollar', show_rating: false, rating_mode: 'scale_10' },
    statuses: ['Want to Visit', 'Visited'],
    categories: [
      { name: 'Clothing', color: '#5C6BC0', icon: '👕' }, { name: 'Home', color: '#8D6E63', icon: '🏠' },
      { name: 'Books', color: '#455A64', icon: '📚' }, { name: 'Food & drink', color: '#C0763A', icon: '🧺' }, { name: 'Gifts', color: '#D2457A', icon: '🎁' },
    ],
    defaultView: 'list', summary: 'Want to Visit · Visited · grouped by category',
  },
  {
    key: 'travel', label: 'Travel', hint: 'Cities, places', icon: '🌍', color: '#2A5C9A',
    suggestedName: 'Travel', layout: 'travel', itemNoun: { one: 'place', many: 'places' }, addPrompt: 'Add a place',
    config: { ...PLACE, show_price: false, price_mode: 'dollar', show_rating: true, rating_mode: 'stars_5' },
    statuses: ['Planned', 'Visited'], categories: [], visibility: 'private', defaultView: 'grouped',
    summary: 'Planned · Visited · grouped by destination',
  },
];

// The presets that existed before V2, offered under "More presets" exactly as they were.
export const MORE_PRESETS: ListPresetDef[] = [
  { key: 'movies', label: 'Movies', hint: 'To watch', icon: '🎬', color: '#3949AB', suggestedName: 'Movies', layout: 'collection', itemNoun: { one: 'movie', many: 'movies' }, addPrompt: 'Add a movie',
    config: { show_location: false, show_price: false, price_mode: 'dollar', show_rating: true, rating_mode: 'stars_5', show_notes: true, show_photos: false }, statuses: ['Want to Watch', 'Watched'], categories: [], defaultView: 'list', summary: 'Want to Watch · Watched · stars' },
  { key: 'shows', label: 'Shows', hint: 'Series', icon: '📺', color: '#5E35B1', suggestedName: 'Shows', layout: 'collection', itemNoun: { one: 'show', many: 'shows' }, addPrompt: 'Add a show',
    config: { show_location: false, show_price: false, price_mode: 'dollar', show_rating: true, rating_mode: 'stars_5', show_notes: true, show_photos: false }, statuses: ['Want to Watch', 'Watching', 'Finished'], categories: [], defaultView: 'list', summary: 'Want to Watch · Watching · Finished' },
  { key: 'books', label: 'Books', hint: 'To read', icon: '📚', color: '#455A64', suggestedName: 'Books', layout: 'collection', itemNoun: { one: 'book', many: 'books' }, addPrompt: 'Add a book',
    config: { show_location: false, show_price: false, price_mode: 'dollar', show_rating: true, rating_mode: 'stars_5', show_notes: true, show_photos: true }, statuses: ['Want to Read', 'Reading', 'Read'], categories: [], defaultView: 'list', summary: 'Want to Read · Reading · Read' },
  { key: 'concerts', label: 'Concerts', hint: 'Shows to see', icon: '🎵', color: '#AD1457', suggestedName: 'Concerts', layout: 'places', itemNoun: { one: 'concert', many: 'concerts' }, addPrompt: 'Add a concert',
    config: { show_location: true, show_price: true, price_mode: 'manual', show_rating: true, rating_mode: 'stars_5', show_notes: true, show_photos: true }, statuses: ['Want to Go', 'Been'], categories: [], defaultView: 'list', summary: 'Want to Go · Been · venue and ticket price' },
  { key: 'wines', label: 'Wines', hint: 'Bottles', icon: '🍷', color: '#7B1F3A', suggestedName: 'Wines', layout: 'tasting', itemNoun: { one: 'wine', many: 'wines' }, addPrompt: 'Add a wine',
    config: { show_location: false, show_price: true, price_mode: 'manual', show_rating: true, rating_mode: 'scale_10', show_notes: true, show_photos: true }, statuses: ['Want to Try', 'Tried'], categories: [], defaultView: 'list', summary: 'Want to Try · Tried · price and 1–10' },
  { key: 'beers', label: 'Beers', hint: 'To try', icon: '🍺', color: '#C9962B', suggestedName: 'Beers', layout: 'tasting', itemNoun: { one: 'beer', many: 'beers' }, addPrompt: 'Add a beer',
    config: { show_location: false, show_price: false, price_mode: 'dollar', show_rating: true, rating_mode: 'scale_10', show_notes: true, show_photos: true }, statuses: ['Want to Try', 'Tried'], categories: [], defaultView: 'list', summary: 'Want to Try · Tried · 1–10' },
];

const ALL_PRESETS = [...V2_PRESETS, ...MORE_PRESETS];

/** Lists created before V2 used the same icon for Coffee Shops; older "📋" lists have no preset. */
export function presetForIcon(icon: string | null | undefined): ListPresetDef | null {
  if (!icon) return null;
  return ALL_PRESETS.find((p) => p.icon === icon) ?? null;
}

type ListShape = Pick<CustomList, 'icon' | 'show_location' | 'show_photos' | 'show_rating' | 'show_price'>;

/** How a list is laid out: its preset's layout when its icon is a preset icon, else read from its fields. */
export function layoutOf(list: ListShape): LayoutKind {
  const preset = presetForIcon(list.icon);
  if (preset) return preset.layout;
  if (list.show_location) return 'places';
  if (list.show_rating && list.show_photos) return 'tasting';
  return 'collection';
}

export function nounOf(list: ListShape): { one: string; many: string } {
  return presetForIcon(list.icon)?.itemNoun ?? (list.show_location ? { one: 'place', many: 'places' } : { one: 'item', many: 'items' });
}

export function addPromptOf(list: ListShape): string {
  return presetForIcon(list.icon)?.addPrompt ?? (list.show_location ? 'Search a place' : `Add ${nounOf(list).one === 'item' ? 'an item' : `a ${nounOf(list).one}`}`);
}

export interface ViewOption { view: ListView; label: string; available: boolean; reason?: string }

/** The views a list can offer, with a reason when one is not available yet. */
export function viewsFor(list: ListShape, data: { categories: number; withPhotos: number; withCoords: number }): ViewOption[] {
  return [
    { view: 'list', label: 'List', available: true },
    { view: 'cards', label: 'Photo cards', available: list.show_photos && data.withPhotos > 0,
      reason: !list.show_photos ? 'Turn on Photos in Customize to use this view' : 'Add a photo to use this view' },
    { view: 'grouped', label: layoutOf(list) === 'travel' ? 'Grouped by destination' : 'Grouped by category', available: data.categories > 0,
      reason: layoutOf(list) === 'travel' ? 'Add a destination to group by it' : 'Add a category to group by it' },
    { view: 'map', label: 'Map', available: list.show_location && data.withCoords > 0,
      reason: !list.show_location ? 'Turn on Location in Customize to use this view' : 'Add a place with an address to use this view' },
  ];
}

export function defaultViewOf(list: ListShape): ListView {
  return presetForIcon(list.icon)?.defaultView ?? 'list';
}
