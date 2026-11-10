/**
 * Which discovery categories a saved place belongs to: Food & Restaurants,
 * Coffee & Cafés, Bars & Drinks - any, several or none.
 *
 * Deterministic and explainable: no AI, no network. Each piece of text we
 * are allowed to use is matched against one dictionary (TERMS below), and
 * every match becomes a piece of evidence with a weight that depends on
 * where the text came from. A category qualifies when its score reaches
 * QUALIFY_SCORE.
 *
 * Evidence, strongest first (SOURCE_WEIGHT):
 *   1. venue_category - the place's own category (Apple's POI category, or
 *      an older Mapbox category still stored on some rows).
 *   2. place_type     - a type someone put the place under ("Cafe", "Bar",
 *      "Brunch", "Italian"), only from people the viewer may see.
 *   3. name           - the venue's own name ("Intelligentsia Coffee").
 *   4. list_title     - the title of a discoverable list the place is in.
 *   5. notes          - authorised notes; supporting evidence only.
 *
 * A category's score is the sum of the best match from each source, so
 * one source can't add up with itself (ten notes mentioning coffee count
 * once) and the weak sources can't qualify a place on their own: a list
 * title (25) plus notes (10) is 35, under the threshold of 50.
 *
 * Terms that are often part of something else ("lounge" in "Airport
 * Lounge", "kitchen", "wine") are marked ambiguous: they count fully as a
 * category or type someone chose, but only half in names, titles and
 * notes. "Bar" is ambiguous only in list titles and notes: in a venue's
 * own name ("Simone's Bar", "Bar Siena") it means a bar, because every
 * common non-drinking "... bar" (sushi, juice, nail, candy, Genius, Bar
 * Method...) is a longer phrase below that is matched first. Phrases are
 * matched longest-first and consume their words, so "Sushi Bar" is food
 * and never also a bar, and "Coffee Table Design" matches nothing.
 *
 * Unknown is not Food, and there is no fallback. Where a place was saved
 * (My Restaurants holds cafés and bars too) says nothing about what it
 * is, so a place with no category, no type and no tell-tale word in its
 * name lands in no category and shows under Explore -> All only. A place
 * whose category we recognise as something else (a museum, a store) can
 * only be put in a category by a type someone chose.
 */

export type PlaceCategoryId = 'food' | 'coffee' | 'drinks';
export const PLACE_CATEGORY_IDS: readonly PlaceCategoryId[] = ['food', 'coffee', 'drinks'];

export type EvidenceSource = 'venue_category' | 'place_type' | 'name' | 'list_title' | 'notes';

/** Weight of a full-strength match from each source. */
export const SOURCE_WEIGHT: Record<EvidenceSource, number> = {
  venue_category: 100,
  place_type: 80,
  name: 60,
  list_title: 25,
  notes: 10,
};

/** Precedence used for "strongest evidence" and the match tier (1 = best). */
export const SOURCE_TIER: Record<EvidenceSource, number> = {
  venue_category: 1,
  place_type: 2,
  name: 3,
  list_title: 4,
  notes: 5,
};

/** A category qualifies at this score. */
export const QUALIFY_SCORE = 50;

/** Ambiguous terms count this much outside venue categories and types. */
const AMBIGUOUS_FACTOR = 0.5;

interface Term {
  /** Normalised, singular words - see normalizeWords(). */
  phrase: string;
  /** Empty for a negative phrase: matched only to stop its words matching. */
  categories: readonly PlaceCategoryId[];
  /** How strongly the term says "this is that kind of place" (default 1). */
  strength?: number;
  /**
   * Counts half where context matters: 'everywhere' = names, list titles
   * and notes; 'context' = list titles and notes only (full in a name).
   * Always full in a venue category or a type someone chose.
   */
  ambiguous?: boolean | 'context';
}

const F: PlaceCategoryId[] = ['food'];
const C: PlaceCategoryId[] = ['coffee'];
const D: PlaceCategoryId[] = ['drinks'];
const FD: PlaceCategoryId[] = ['food', 'drinks'];
const NONE: PlaceCategoryId[] = [];

/**
 * The dictionary. Add a word here and every surface (Home, Explore list,
 * map and rail) picks it up. Phrases use the normalised singular form:
 * lower case, no accents, "&" as "and".
 */
const TERMS: readonly Term[] = [
  // --- Phrases that look like a category but aren't (match nothing) ---
  { phrase: 'coffee table', categories: NONE },
  { phrase: 'coffee table book', categories: NONE },
  { phrase: 'coffee maker', categories: NONE },
  { phrase: 'coffee mug', categories: NONE },
  { phrase: 'coffee bean', categories: NONE },
  { phrase: 'bar exam', categories: NONE },
  { phrase: 'bar association', categories: NONE },
  { phrase: 'candy bar', categories: NONE },
  { phrase: 'chocolate bar', categories: NONE },
  { phrase: 'granola bar', categories: NONE },
  { phrase: 'protein bar', categories: NONE },
  { phrase: 'juice bar', categories: NONE },
  { phrase: 'oxygen bar', categories: NONE },
  { phrase: 'nail bar', categories: NONE },
  { phrase: 'brow bar', categories: NONE },
  { phrase: 'blow dry bar', categories: NONE },
  { phrase: 'genius bar', categories: NONE },
  { phrase: 'lash bar', categories: NONE },
  { phrase: 'wax bar', categories: NONE },
  { phrase: 'waxing bar', categories: NONE },
  { phrase: 'beauty bar', categories: NONE },
  { phrase: 'blowout bar', categories: NONE },
  { phrase: 'smoothie bar', categories: NONE },
  { phrase: 'yogurt bar', categories: NONE },
  { phrase: 'cereal bar', categories: NONE },
  { phrase: 'energy bar', categories: NONE },
  { phrase: 'mini bar', categories: NONE },
  { phrase: 'minibar', categories: NONE },
  { phrase: 'bar method', categories: NONE },
  { phrase: 'bar harbor', categories: NONE },
  { phrase: 'bar mitzvah', categories: NONE },
  { phrase: 'bar stool', categories: NONE },
  { phrase: 'bar cart', categories: NONE },
  { phrase: 'bar code', categories: NONE },
  { phrase: 'bar chart', categories: NONE },
  { phrase: 'bar soap', categories: NONE },
  { phrase: 'monkey bar', categories: NONE },
  { phrase: 'pull up bar', categories: NONE },
  { phrase: 'airport lounge', categories: NONE },
  { phrase: 'hookah lounge', categories: NONE },
  { phrase: 'waiting lounge', categories: NONE },
  { phrase: 'food bank', categories: NONE },
  { phrase: 'pet food', categories: NONE },
  { phrase: 'dog food', categories: NONE },
  { phrase: 'tea towel', categories: NONE },
  { phrase: 'wine opener', categories: NONE },
  { phrase: 'wine glass', categories: NONE },

  // --- Coffee & Cafés ---
  { phrase: 'cafe', categories: C },
  { phrase: 'caffe', categories: C },
  { phrase: 'kafe', categories: C },
  { phrase: 'kaffee', categories: C },
  { phrase: 'kahve', categories: C },
  { phrase: 'kahvesi', categories: C },
  { phrase: 'coffee', categories: C },
  { phrase: 'coffeehouse', categories: C },
  { phrase: 'coffee house', categories: C },
  { phrase: 'coffee shop', categories: C },
  { phrase: 'coffeeshop', categories: C },
  { phrase: 'coffee bar', categories: C },
  { phrase: 'coffee roaster', categories: C },
  { phrase: 'coffee roastery', categories: C },
  { phrase: 'roastery', categories: C },
  { phrase: 'roaster', categories: C, strength: 0.9 },
  { phrase: 'espresso', categories: C },
  { phrase: 'espresso bar', categories: C },
  { phrase: 'cappuccino', categories: C },
  { phrase: 'latte', categories: C },
  { phrase: 'matcha', categories: C },
  { phrase: 'tea house', categories: C },
  { phrase: 'teahouse', categories: C },
  { phrase: 'tea room', categories: C },
  { phrase: 'tearoom', categories: C },
  { phrase: 'tea shop', categories: C },
  { phrase: 'tea bar', categories: C },
  { phrase: 'bubble tea', categories: C },
  { phrase: 'boba', categories: C },
  { phrase: 'tea', categories: C, ambiguous: true },

  // --- Bars & Drinks ---
  { phrase: 'bar', categories: D, ambiguous: 'context' },
  { phrase: 'nightlife', categories: D, strength: 0.9 },
  { phrase: 'nightclub', categories: D },
  { phrase: 'night club', categories: D },
  { phrase: 'pub', categories: D },
  { phrase: 'gastropub', categories: FD },
  { phrase: 'brewpub', categories: FD },
  { phrase: 'tavern', categories: D },
  { phrase: 'saloon', categories: D },
  { phrase: 'speakeasy', categories: D },
  { phrase: 'taproom', categories: D },
  { phrase: 'tap room', categories: D },
  { phrase: 'tap house', categories: D },
  { phrase: 'taphouse', categories: D },
  { phrase: 'beer garden', categories: D },
  { phrase: 'biergarten', categories: D },
  { phrase: 'beer hall', categories: D },
  { phrase: 'beer bar', categories: D },
  { phrase: 'brewery', categories: D },
  { phrase: 'brewing', categories: D },
  { phrase: 'brewing company', categories: D },
  { phrase: 'winery', categories: D },
  { phrase: 'vineyard', categories: D, strength: 0.9 },
  { phrase: 'distillery', categories: D },
  { phrase: 'wine bar', categories: D },
  { phrase: 'wine room', categories: D },
  { phrase: 'wine', categories: D, ambiguous: true },
  { phrase: 'beer', categories: D, ambiguous: true },
  { phrase: 'cocktail', categories: D },
  { phrase: 'cocktail bar', categories: D },
  { phrase: 'cocktail lounge', categories: D },
  { phrase: 'lounge', categories: D, ambiguous: true },
  { phrase: 'sports bar', categories: D },
  { phrase: 'dive bar', categories: D },
  { phrase: 'piano bar', categories: D },
  { phrase: 'tiki bar', categories: D },
  { phrase: 'rooftop bar', categories: D },
  { phrase: 'hotel bar', categories: D },
  { phrase: 'whiskey bar', categories: D },
  { phrase: 'whisky bar', categories: D },
  { phrase: 'mezcaleria', categories: D },
  { phrase: 'drink', categories: D, ambiguous: true },
  { phrase: 'happy hour', categories: D, ambiguous: true },
  { phrase: 'meyhane', categories: FD },
  { phrase: 'meyhanesi', categories: FD },
  { phrase: 'izakaya', categories: FD },
  { phrase: 'cantina', categories: FD, ambiguous: true },

  // --- Food & Restaurants ---
  { phrase: 'restaurant', categories: F },
  { phrase: 'ristorante', categories: F },
  { phrase: 'restaurante', categories: F },
  { phrase: 'trattoria', categories: F },
  { phrase: 'osteria', categories: F },
  { phrase: 'pizzeria', categories: F },
  { phrase: 'pizza', categories: F },
  { phrase: 'sushi', categories: F },
  { phrase: 'sushi bar', categories: F },
  { phrase: 'ramen', categories: F },
  { phrase: 'ramen bar', categories: F },
  { phrase: 'ramen shop', categories: F },
  { phrase: 'noodle', categories: F },
  { phrase: 'noodle bar', categories: F },
  { phrase: 'dumpling', categories: F },
  { phrase: 'dim sum', categories: F },
  { phrase: 'pho', categories: F },
  { phrase: 'steakhouse', categories: F },
  { phrase: 'steak house', categories: F },
  { phrase: 'chophouse', categories: F },
  { phrase: 'diner', categories: F },
  { phrase: 'bistro', categories: F },
  { phrase: 'brasserie', categories: F },
  { phrase: 'taqueria', categories: F },
  { phrase: 'taco', categories: F },
  { phrase: 'taco bar', categories: F },
  { phrase: 'burrito', categories: F },
  { phrase: 'bbq', categories: F },
  { phrase: 'barbecue', categories: F },
  { phrase: 'barbeque', categories: F },
  { phrase: 'smokehouse', categories: F },
  { phrase: 'burger', categories: F },
  { phrase: 'eatery', categories: F },
  { phrase: 'deli', categories: F },
  { phrase: 'delicatessen', categories: F },
  { phrase: 'sandwich', categories: F },
  { phrase: 'bagel', categories: F },
  { phrase: 'creperie', categories: F },
  { phrase: 'kebab', categories: F },
  { phrase: 'kebap', categories: F },
  { phrase: 'lokanta', categories: F },
  { phrase: 'lokantasi', categories: F },
  { phrase: 'ocakbasi', categories: F },
  { phrase: 'pide', categories: F },
  { phrase: 'oyster bar', categories: F },
  { phrase: 'raw bar', categories: F },
  { phrase: 'salad bar', categories: F },
  { phrase: 'snack bar', categories: F },
  { phrase: 'poke bar', categories: F },
  { phrase: 'dessert bar', categories: F, strength: 0.85 },
  { phrase: 'chicken', categories: F, ambiguous: true },
  { phrase: 'seafood', categories: F },
  { phrase: 'fish market', categories: F, strength: 0.6 },
  { phrase: 'food hall', categories: F },
  { phrase: 'food court', categories: F },
  { phrase: 'food truck', categories: F },
  // Apple's FoodMarket: food halls and markets people save as food places;
  // counts as Food, below a restaurant.
  { phrase: 'food market', categories: F, strength: 0.6 },
  { phrase: 'bakery', categories: F, strength: 0.85 },
  { phrase: 'patisserie', categories: F, strength: 0.85 },
  { phrase: 'boulangerie', categories: F, strength: 0.85 },
  { phrase: 'brunch', categories: F },
  { phrase: 'breakfast', categories: F },
  { phrase: 'lunch', categories: F },
  { phrase: 'dinner', categories: F },
  { phrase: 'supper club', categories: FD },
  { phrase: 'bar and grill', categories: FD },
  { phrase: 'grill', categories: F, ambiguous: true },
  { phrase: 'grille', categories: F, ambiguous: true },
  { phrase: 'kitchen', categories: F, ambiguous: true },
  { phrase: 'cucina', categories: F },
  { phrase: 'cocina', categories: F },
  { phrase: 'cafeteria', categories: F },
  { phrase: 'canteen', categories: F, ambiguous: true },
  { phrase: 'food', categories: F, ambiguous: true },
  { phrase: 'eat', categories: F, ambiguous: true },
  { phrase: 'tapas', categories: F },
  { phrase: 'omakase', categories: F },
  { phrase: 'tasting menu', categories: F },
  { phrase: 'fine dining', categories: F },
  // Cuisines: a type someone chose ("Italian") is a strong signal; the
  // same word in a venue's name ("The Italian Job") is not.
  ...[
    'italian', 'mexican', 'japanese', 'chinese', 'thai', 'indian', 'korean', 'vietnamese', 'greek',
    'turkish', 'french', 'spanish', 'mediterranean', 'lebanese', 'middle eastern', 'ethiopian',
    'peruvian', 'american', 'southern', 'cajun', 'caribbean', 'cuban', 'brazilian', 'argentinian',
    'persian', 'moroccan', 'filipino', 'polish', 'german', 'vegan', 'vegetarian', 'halal',
  ].map((phrase): Term => ({ phrase, categories: F, ambiguous: true })),
];

/**
 * Venue categories that say "this is not a food or drink place". When the
 * venue category is one of these and nothing in it matched a term, names,
 * titles and notes can't put the place in a category - only a type
 * someone chose can (a hotel someone filed under "Bar").
 */
const NON_FOOD_VENUES = new Set(
  [
    'airport', 'amusement park', 'animal service', 'aquarium', 'atm', 'automotive repair', 'bank',
    'baseball', 'basketball', 'beach', 'beauty', 'bookstore', 'bowling', 'campground', 'car rental',
    'castle', 'convention center', 'ev charger', 'fairground', 'fire station', 'fitness center',
    'fortress', 'gas station', 'go kart', 'golf', 'hiking', 'hospital', 'hotel', 'kayaking',
    'landmark', 'laundry', 'library', 'marina', 'mini golf', 'movie theater', 'museum', 'music venue',
    'national monument', 'national park', 'park', 'parking', 'pharmacy', 'planetarium', 'police',
    'post office', 'public transport', 'restroom', 'rock climbing', 'rv park', 'school', 'skatepark',
    'skating', 'skiing', 'soccer', 'spa', 'stadium', 'store', 'surfing', 'swimming', 'tennis',
    'theater', 'university', 'volleyball', 'zoo', 'book', 'shop', 'gallery', 'gym', 'salon',
  ],
);

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Turkish dotless i and a few letters NFKD doesn't take apart. */
const LETTER_FOLDS: Record<string, string> = { ı: 'i', ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd' };

/** Plural to singular, only as far as the dictionary needs it. */
function singular(word: string): string {
  if (word.length <= 3 || word.endsWith('ss') || word.endsWith('us') || word.endsWith('is')) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ch|sh|x)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/**
 * Text -> comparable words. Splits Apple's CamelCase ids ("FoodMarket")
 * and old snake_case categories, strips accents ("Café" -> "cafe"),
 * reads "&" as "and", drops apostrophes ("Joe's" -> "joes") and makes
 * every word singular. Matching on whole words is what keeps "bar" out
 * of "barbecue" and "barber", and "tea" out of "steak".
 */
export function normalizeWords(text: string | null | undefined): string[] {
  if (!text) return [];
  const split = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[ıøæœßłđ]/g, (ch) => LETTER_FOLDS[ch] ?? ch)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return split ? split.split(/\s+/).map(singular) : [];
}

const TERM_INDEX = new Map<string, Term>();
let LONGEST_TERM = 1;
for (const term of TERMS) {
  const key = normalizeWords(term.phrase).join(' ');
  TERM_INDEX.set(key, term);
  LONGEST_TERM = Math.max(LONGEST_TERM, key.split(' ').length);
}
const NON_FOOD_INDEX = new Set([...NON_FOOD_VENUES].map((v) => normalizeWords(v).join(' ')));

interface TermMatch {
  term: Term;
  /** The words as they appeared, normalised. */
  matched: string;
}

/** Longest-first phrase matches; each word belongs to at most one phrase. */
function matchTerms(words: string[], index: Map<string, Term> | Set<string>): TermMatch[] {
  const out: TermMatch[] = [];
  let i = 0;
  while (i < words.length) {
    let found = 0;
    for (let len = Math.min(LONGEST_TERM, words.length - i); len >= 1; len--) {
      const key = words.slice(i, i + len).join(' ');
      if (index.has(key)) {
        out.push({ term: index instanceof Map ? index.get(key)! : { phrase: key, categories: NONE }, matched: key });
        found = len;
        break;
      }
    }
    i += found || 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export interface ClassificationInput {
  /** The venue's name. */
  name?: string | null;
  /** The place's own category (Apple POI category or an older stored one). */
  venueCategory?: string | null;
  /** Types the viewer is allowed to see (My Restaurants types, list types). */
  placeTypes?: readonly (string | null | undefined)[];
  /** Titles/descriptions of discoverable lists the place is in. */
  listTitles?: readonly (string | null | undefined)[];
  /** Notes the viewer is allowed to see. Supporting evidence only. */
  notes?: readonly (string | null | undefined)[];
}

export interface Evidence {
  source: EvidenceSource;
  category: PlaceCategoryId;
  /** The dictionary phrase that matched. */
  term: string;
  /** The text it was found in. */
  text: string;
  weight: number;
}

export interface PlaceClassification {
  /** Qualifying categories, most certain first. Empty = not food or drink (or unknown). */
  categories: PlaceCategoryId[];
  /** First of categories, or null. */
  primary: PlaceCategoryId | null;
  /** Score per category (sum of the best match from each source). */
  scores: Record<PlaceCategoryId, number>;
  /** The best piece of evidence per qualifying category. */
  strongest: Partial<Record<PlaceCategoryId, Evidence>>;
  /**
   * 1-5 per qualifying category: the source of its strongest evidence
   * (1 venue category ... 5 notes). Lower is more certain; used to order
   * places within a category.
   */
  tier: Partial<Record<PlaceCategoryId, number>>;
  /** Every match, for debugging and tests. */
  evidence: Evidence[];
  /** The venue category is recognised as something other than food or drink. */
  nonFoodVenue: boolean;
  /** One line per qualifying category, e.g. "coffee: venue category 'Cafe' (100)". */
  reason: string;
}

const SOURCE_LABEL: Record<EvidenceSource, string> = {
  venue_category: 'venue category',
  place_type: 'type',
  name: 'name',
  list_title: 'list title',
  notes: 'notes',
};

const clean = (values: readonly (string | null | undefined)[] | undefined) =>
  (values ?? []).filter((v): v is string => !!v && !!v.trim());

export function classifyPlace(input: ClassificationInput): PlaceClassification {
  const evidence: Evidence[] = [];

  const collect = (source: EvidenceSource, texts: string[]) => {
    for (const text of texts) {
      for (const { term, matched } of matchTerms(normalizeWords(text), TERM_INDEX)) {
        const halved =
          term.ambiguous === 'context'
            ? source === 'list_title' || source === 'notes'
            : !!term.ambiguous && source !== 'venue_category' && source !== 'place_type';
        const factor = (term.strength ?? 1) * (halved ? AMBIGUOUS_FACTOR : 1);
        for (const category of term.categories) {
          evidence.push({ source, category, term: matched, text, weight: Math.round(SOURCE_WEIGHT[source] * factor) });
        }
      }
    }
  };

  const venueCategory = input.venueCategory?.trim() || null;
  collect('venue_category', venueCategory ? [venueCategory] : []);
  const venueWords = normalizeWords(venueCategory);
  const nonFoodVenue =
    !!venueCategory &&
    !evidence.some((e) => e.source === 'venue_category') &&
    matchTerms(venueWords, NON_FOOD_INDEX).length > 0;

  collect('place_type', clean(input.placeTypes));
  if (!nonFoodVenue) {
    collect('name', clean([input.name]));
    collect('list_title', clean(input.listTitles));
    collect('notes', clean(input.notes));
  }

  const scores: Record<PlaceCategoryId, number> = { food: 0, coffee: 0, drinks: 0 };
  const strongest: Partial<Record<PlaceCategoryId, Evidence>> = {};
  for (const category of PLACE_CATEGORY_IDS) {
    const bestBySource = new Map<EvidenceSource, Evidence>();
    for (const e of evidence) {
      if (e.category !== category) continue;
      const prev = bestBySource.get(e.source);
      if (!prev || e.weight > prev.weight) bestBySource.set(e.source, e);
    }
    for (const e of bestBySource.values()) {
      scores[category] += e.weight;
      const s = strongest[category];
      if (!s || e.weight > s.weight || (e.weight === s.weight && SOURCE_TIER[e.source] < SOURCE_TIER[s.source])) {
        strongest[category] = e;
      }
    }
  }

  let categories = PLACE_CATEGORY_IDS.filter((c) => scores[c] >= QUALIFY_SCORE);

  const tier: Partial<Record<PlaceCategoryId, number>> = {};
  for (const c of categories) tier[c] = SOURCE_TIER[strongest[c]!.source];

  // Most certain first: the source of the best evidence (a venue category
  // outranks a type someone added), then score, then food/coffee/drinks.
  categories = [...categories].sort(
    (a, b) =>
      tier[a]! - tier[b]! || scores[b] - scores[a] || PLACE_CATEGORY_IDS.indexOf(a) - PLACE_CATEGORY_IDS.indexOf(b),
  );
  for (const c of PLACE_CATEGORY_IDS) if (!categories.includes(c)) delete strongest[c];

  const reason =
    categories.length === 0
      ? nonFoodVenue
        ? `none: venue category '${venueCategory}' is not food or drink`
        : 'none: no evidence reached the threshold'
      : categories
          .map((c) => {
            const e = strongest[c]!;
            return `${c}: ${SOURCE_LABEL[e.source]} '${e.text}' matched "${e.term}" (score ${scores[c]})`;
          })
          .join('; ');

  return { categories, primary: categories[0] ?? null, scores, strongest, tier, evidence, nonFoodVenue, reason };
}

/** True when the record is a real-world place (it can be found on a map). */
export function isLocatablePlace(row: {
  apple_place_id?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): boolean {
  return (
    !!row.apple_place_id?.trim() ||
    !!row.address?.trim() ||
    (row.latitude != null && row.longitude != null)
  );
}
