// Lists V2: the item fields each preset offers, beyond the built-in ones (name, status, categories,
// rating, price, notes, photos, location).
//
// Stored per list as plain definitions {key, label, type, options?, hidden?} in the owner-only
// custom_list_owner_settings table, and per item as {key: value} in custom_list_item_owner_values
// (db/proposals/lists_v2_owner_fields.sql). Everything else here (which fields are "main", suggestions,
// placeholders, which Drinks category a field belongs to) is presentation, kept in code, so it can change
// without touching saved data. Keys are unique across the whole catalogue and never reused for something else.

export type FieldType = 'text' | 'number' | 'date' | 'tags' | 'choice' | 'multi';

/** What is saved for a list. Mirrors lv2_fields_ok() in the SQL. */
export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  hidden?: boolean;
}

export interface FieldUi {
  /** Main fields show in the form straight away; the rest sit under "More details". */
  tier: 'main' | 'more';
  placeholder?: string;
  /** Tappable suggestions for a tags field; anything else can still be typed. */
  suggestions?: string[];
  /** Numbers: whole numbers only, and a sensible range. */
  integer?: boolean;
  min?: number;
  max?: number;
  unit?: string;
  /** Drinks: only shown when the item has one of these categories (matched by name, case-insensitively). */
  forCategories?: string[];
  /** A clearer name where the label alone repeats another field's (the New list sheet's Details chips). */
  chipLabel?: string;
}

type CatalogueEntry = Omit<FieldDef, 'hidden'> & FieldUi;

const ROASTS = ['Light', 'Light-Medium', 'Medium', 'Medium-Dark', 'Dark', 'Extra Dark'];
const BEST_FOR = ['Espresso', 'Pour-over', 'Cold Brew', 'Other'];
const COFFEE_TASTES = ['Fruity', 'Floral', 'Citrus', 'Berry', 'Chocolate', 'Nutty', 'Caramel', 'Spice', 'Earthy'];
const WINE_COLORS = ['Red', 'White', 'Rosé', 'Orange'];
const WINE_STYLES = ['Still', 'Sparkling', 'Dessert', 'Fortified'];
const BEER_STYLES = ['IPA', 'Hazy IPA', 'Pale Ale', 'Lager', 'Pilsner', 'Wheat', 'Stout', 'Porter', 'Sour', 'Saison', 'Amber', 'Brown Ale', 'Belgian', 'Other'];
const BEER_TASTES = ['Hoppy', 'Malty', 'Citrus', 'Tropical', 'Roasty', 'Sour', 'Crisp', 'Bitter', 'Sweet'];
const YEAR = { integer: true, min: 1800, max: 2100 } as const;
const BEER = ['beer'];
const WINE = ['wine'];

/** Every field any preset uses, by key. */
export const FIELD_CATALOGUE: Record<string, CatalogueEntry> = {
  // Coffee Beans (the item's name is the coffee's name)
  c_roaster: { key: 'c_roaster', label: 'Roaster', type: 'text', tier: 'main', placeholder: 'Who roasted it' },
  c_roast: { key: 'c_roast', label: 'Roast', type: 'choice', options: ROASTS, tier: 'main' },
  c_taste_profile: { key: 'c_taste_profile', label: 'Taste profile', type: 'tags', tier: 'main', suggestions: COFFEE_TASTES, placeholder: 'Add your own, e.g. jasmine' },
  c_best_for: { key: 'c_best_for', label: 'Best for', type: 'multi', options: BEST_FOR, tier: 'more' },
  c_origin: { key: 'c_origin', label: 'Origin', type: 'text', tier: 'more', placeholder: 'Country or region' },
  c_process: { key: 'c_process', label: 'Process', type: 'choice', options: ['Washed', 'Natural', 'Honey', 'Anaerobic', 'Other'], tier: 'more' },
  c_roast_date: { key: 'c_roast_date', label: 'Roast date', type: 'date', tier: 'more' },

  // Wine (Wines preset, and Drinks items in a "Wine" category). Colour and style are separate.
  c_wine_color: { key: 'c_wine_color', label: 'Colour', type: 'choice', options: WINE_COLORS, tier: 'main', forCategories: WINE, chipLabel: 'Wine colour' },
  c_producer: { key: 'c_producer', label: 'Producer', type: 'text', tier: 'main', placeholder: 'Winery or producer', forCategories: WINE },
  c_vintage: { key: 'c_vintage', label: 'Vintage', type: 'number', tier: 'main', ...YEAR, placeholder: 'e.g. 2019', forCategories: WINE },
  c_wine_style: { key: 'c_wine_style', label: 'Style', type: 'choice', options: WINE_STYLES, tier: 'more', forCategories: WINE, chipLabel: 'Wine style' },
  c_wine_name: { key: 'c_wine_name', label: 'Wine name', type: 'text', tier: 'more', placeholder: 'Name on the label', forCategories: WINE },
  c_vineyard: { key: 'c_vineyard', label: 'Vineyard', type: 'text', tier: 'more', forCategories: WINE },
  c_grapes: { key: 'c_grapes', label: 'Grapes', type: 'tags', tier: 'more', suggestions: ['Cabernet Sauvignon', 'Merlot', 'Pinot Noir', 'Syrah', 'Chardonnay', 'Sauvignon Blanc', 'Riesling'], forCategories: WINE },
  c_region: { key: 'c_region', label: 'Region', type: 'text', tier: 'more', placeholder: 'e.g. Rioja, Napa Valley', forCategories: WINE },

  // Beer (Beers preset, and Drinks items in a "Beer" category)
  c_brewery: { key: 'c_brewery', label: 'Brewery', type: 'text', tier: 'main', forCategories: BEER },
  c_beer_style: { key: 'c_beer_style', label: 'Style', type: 'choice', options: BEER_STYLES, tier: 'main', forCategories: BEER, chipLabel: 'Beer style' },
  c_abv: { key: 'c_abv', label: 'ABV', type: 'number', tier: 'more', min: 0, max: 100, unit: '%' },
  c_ibu: { key: 'c_ibu', label: 'IBU', type: 'number', tier: 'more', integer: true, min: 0, max: 200, forCategories: BEER },
  c_beer_taste: { key: 'c_beer_taste', label: 'Taste', type: 'tags', tier: 'more', suggestions: BEER_TASTES, forCategories: BEER, chipLabel: 'Beer taste' },

  // Movies and shows
  c_year: { key: 'c_year', label: 'Year', type: 'number', tier: 'main', ...YEAR },
  c_director: { key: 'c_director', label: 'Director', type: 'text', tier: 'main' },
  c_genre: { key: 'c_genre', label: 'Genre', type: 'tags', tier: 'more', suggestions: ['Drama', 'Comedy', 'Thriller', 'Documentary', 'Sci-fi', 'Animation', 'Romance', 'Horror'] },
  c_runtime: { key: 'c_runtime', label: 'Runtime', type: 'number', tier: 'more', integer: true, min: 1, max: 1000, unit: 'min' },
  c_where_to_watch: { key: 'c_where_to_watch', label: 'Where to watch', type: 'text', tier: 'more', placeholder: 'e.g. Netflix, cinema' },
  c_watched_on: { key: 'c_watched_on', label: 'Watched on', type: 'date', tier: 'more' },
  c_service: { key: 'c_service', label: 'Service', type: 'text', tier: 'main', placeholder: 'e.g. Netflix, HBO' },
  c_seasons: { key: 'c_seasons', label: 'Seasons', type: 'number', tier: 'main', integer: true, min: 1, max: 100 },
  c_up_to: { key: 'c_up_to', label: 'Up to', type: 'text', tier: 'more', placeholder: 'e.g. S2 E5' },
  c_finished_on: { key: 'c_finished_on', label: 'Finished on', type: 'date', tier: 'more' },

  // Books
  c_author: { key: 'c_author', label: 'Author', type: 'text', tier: 'main' },
  c_book_format: { key: 'c_book_format', label: 'Format', type: 'choice', options: ['Print', 'Ebook', 'Audiobook'], tier: 'main' },
  c_pages: { key: 'c_pages', label: 'Pages', type: 'number', tier: 'more', integer: true, min: 1, max: 20000 },
  c_series: { key: 'c_series', label: 'Series', type: 'text', tier: 'more', placeholder: 'e.g. Dune #2' },
  c_isbn: { key: 'c_isbn', label: 'ISBN', type: 'text', tier: 'more' },

  // Concerts (venue is the list's location; ticket price is the list's price)
  c_artist: { key: 'c_artist', label: 'Artist', type: 'text', tier: 'main' },
  c_event_date: { key: 'c_event_date', label: 'Date', type: 'date', tier: 'main' },
  c_tour: { key: 'c_tour', label: 'Tour', type: 'text', tier: 'more' },
  c_support: { key: 'c_support', label: 'Supporting acts', type: 'tags', tier: 'more' },
  c_seat: { key: 'c_seat', label: 'Seat or section', type: 'text', tier: 'more' },

  // Places
  c_cuisine: { key: 'c_cuisine', label: 'Cuisine', type: 'text', tier: 'main', placeholder: 'e.g. Italian' },
  c_dishes: { key: 'c_dishes', label: 'Dishes', type: 'tags', tier: 'main', placeholder: 'What to order' },
  c_visit_date: { key: 'c_visit_date', label: 'Visit date', type: 'date', tier: 'more' },
  c_occasion: { key: 'c_occasion', label: 'Occasion', type: 'tags', tier: 'more', suggestions: ['Date night', 'Friends', 'Family', 'Work', 'Solo'] },
  c_ordered: { key: 'c_ordered', label: 'What I ordered', type: 'tags', tier: 'main', suggestions: ['Espresso', 'Flat white', 'Latte', 'Pour-over', 'Pastry'] },
  c_good_for_work: { key: 'c_good_for_work', label: 'Good for working', type: 'choice', options: ['Yes', 'No'], tier: 'main' },
  c_roaster_served: { key: 'c_roaster_served', label: 'Roaster they serve', type: 'text', tier: 'more' },
  c_sells: { key: 'c_sells', label: 'What they sell', type: 'tags', tier: 'main' },
  c_brands: { key: 'c_brands', label: 'Brands', type: 'tags', tier: 'main' },
  c_wishlist: { key: 'c_wishlist', label: 'Things I want', type: 'tags', tier: 'more' },

  // Travel
  c_country: { key: 'c_country', label: 'Country', type: 'text', tier: 'main' },
  c_trip_from: { key: 'c_trip_from', label: 'From', type: 'date', tier: 'main' },
  c_trip_to: { key: 'c_trip_to', label: 'To', type: 'date', tier: 'main' },
  c_with: { key: 'c_with', label: 'Who with', type: 'tags', tier: 'more' },
  c_stay: { key: 'c_stay', label: 'Where I stayed', type: 'text', tier: 'more' },

  // Drinks: cocktails and spirits
  c_base_spirit: { key: 'c_base_spirit', label: 'Base spirit', type: 'choice', options: ['Gin', 'Vodka', 'Rum', 'Tequila', 'Whisky', 'Brandy', 'Other'], tier: 'main', forCategories: ['cocktail', 'cocktails'] },
  c_ingredients: { key: 'c_ingredients', label: 'Ingredients', type: 'tags', tier: 'more', forCategories: ['cocktail', 'cocktails'] },
  c_distillery: { key: 'c_distillery', label: 'Distillery', type: 'text', tier: 'main', forCategories: ['spirit', 'spirits'] },
  c_spirit_kind: { key: 'c_spirit_kind', label: 'Kind', type: 'choice', options: ['Whisky', 'Gin', 'Rum', 'Tequila', 'Mezcal', 'Brandy', 'Liqueur', 'Other'], tier: 'main', forCategories: ['spirit', 'spirits'], chipLabel: 'Spirit kind' },
};

/** Which fields each preset gets, in form order. */
export const PRESET_FIELDS: Record<string, string[]> = {
  coffee_beans: ['c_roaster', 'c_roast', 'c_taste_profile', 'c_best_for', 'c_origin', 'c_process', 'c_roast_date'],
  wines: ['c_producer', 'c_vintage', 'c_wine_color', 'c_wine_style', 'c_wine_name', 'c_vineyard', 'c_grapes', 'c_region', 'c_abv'],
  beers: ['c_brewery', 'c_beer_style', 'c_abv', 'c_ibu', 'c_beer_taste'],
  drinks: ['c_brewery', 'c_beer_style', 'c_producer', 'c_vintage', 'c_wine_color', 'c_base_spirit', 'c_distillery', 'c_spirit_kind',
    'c_abv', 'c_ibu', 'c_beer_taste', 'c_wine_style', 'c_wine_name', 'c_vineyard', 'c_grapes', 'c_region', 'c_ingredients'],
  movies: ['c_year', 'c_director', 'c_genre', 'c_runtime', 'c_where_to_watch', 'c_watched_on'],
  shows: ['c_service', 'c_seasons', 'c_genre', 'c_up_to', 'c_finished_on'],
  books: ['c_author', 'c_book_format', 'c_genre', 'c_pages', 'c_series', 'c_isbn', 'c_finished_on'],
  concerts: ['c_artist', 'c_event_date', 'c_tour', 'c_support', 'c_seat'],
  restaurants: ['c_cuisine', 'c_dishes', 'c_visit_date', 'c_occasion'],
  coffee_shops: ['c_ordered', 'c_good_for_work', 'c_roaster_served', 'c_visit_date'],
  stores: ['c_sells', 'c_brands', 'c_wishlist'],
  travel: ['c_country', 'c_trip_from', 'c_trip_to', 'c_with', 'c_stay'],
};

/** What the item's name field is called where "Name" would be vague (Coffee Beans: the coffee's name, not the roaster). */
export const NAME_LABELS: Record<string, string> = { coffee_beans: 'Coffee name' };

/** Wines and Beers get the wine/beer fields whatever the item's category; only Drinks filters by category. */
const FILTERS_BY_CATEGORY = new Set(['drinks']);

const toDef = ({ key, label, type, options }: CatalogueEntry): FieldDef => (options ? { key, label, type, options: [...options] } : { key, label, type });

/** The definitions saved for a new list made from this preset (empty for a preset without extra fields). */
export function fieldsForPreset(presetKey: string | null | undefined): FieldDef[] {
  return (presetKey ? PRESET_FIELDS[presetKey] ?? [] : []).map((k) => toDef(FIELD_CATALOGUE[k]));
}

/** Presentation for a saved field; a field this version doesn't know (e.g. from a newer app) shows as plain "more". */
export function uiOf(def: FieldDef): FieldUi {
  const entry = FIELD_CATALOGUE[def.key];
  return entry ? { ...entry } : { tier: 'more' };
}

/** The fields to offer for one item: not hidden, and, on a Drinks list, matching the item's categories. */
export function visibleFields(fields: FieldDef[], presetKey: string | null | undefined, categoryNames: string[]): FieldDef[] {
  const cats = categoryNames.map((c) => c.trim().toLowerCase());
  const filter = !!presetKey && FILTERS_BY_CATEGORY.has(presetKey);
  return fields.filter((f) => {
    if (f.hidden) return false;
    const only = uiOf(f).forCategories;
    if (!filter || !only) return true;
    return cats.some((c) => only.some((o) => c === o || c.startsWith(o)));
  });
}

/**
 * The definitions to save when fields are added to a list that already exists: what it has, plus any of the
 * preset's fields it doesn't have yet. Nothing existing is renamed, retyped or removed. A Coffee Beans list
 * that already uses roast categories gets the Roast field hidden, so there is only one roast control.
 */
export function mergePresetFields(existing: FieldDef[], presetKey: string, categoryNames: string[]): FieldDef[] {
  const have = new Set(existing.map((f) => f.key));
  const usesRoastCategories = categoryNames.some((c) => /\broast\b/i.test(c));
  const added = fieldsForPreset(presetKey)
    .filter((f) => !have.has(f.key))
    .map((f) => (f.key === 'c_roast' && usesRoastCategories ? { ...f, hidden: true } : f));
  return [...existing, ...added];
}
