import type { ClassificationInput, PlaceCategoryId } from '@/lib/placeClassification';

/**
 * Representative places for CP4's classifier, shaped like what the app
 * actually receives: Apple POI categories (CamelCase), older Mapbox-era
 * category strings, hand-typed places with no category, My Restaurants
 * types (including the seeded Lunch / Dinner / Breakfast / Brunch /
 * Bakery / Cafe / Bar), list titles and notes.
 *
 * `expected` is what a person would say the place is. The evaluation test
 * runs every fixture and fails on any mismatch, so a dictionary or weight
 * change that adds a false positive or negative shows up here.
 */
export interface PlaceFixture {
  label: string;
  input: ClassificationInput;
  expected: PlaceCategoryId[];
}

export const PLACE_FIXTURES: PlaceFixture[] = [
  // --- Apple venue categories ---
  { label: 'Apple Restaurant', input: { name: 'Girl & the Goat', venueCategory: 'Restaurant' }, expected: ['food'] },
  { label: 'Apple Cafe', input: { name: 'Sawada Coffee', venueCategory: 'Cafe' }, expected: ['coffee'] },
  { label: 'Apple Nightlife', input: { name: 'The Violet Hour', venueCategory: 'Nightlife' }, expected: ['drinks'] },
  { label: 'Apple Brewery', input: { name: 'Half Acre', venueCategory: 'Brewery' }, expected: ['drinks'] },
  { label: 'Apple Winery', input: { name: 'City Winery', venueCategory: 'Winery' }, expected: ['drinks'] },
  { label: 'Apple Distillery', input: { name: 'KOVAL', venueCategory: 'Distillery' }, expected: ['drinks'] },
  { label: 'Apple Bakery', input: { name: 'Hewn', venueCategory: 'Bakery' }, expected: ['food'] },
  { label: 'Apple FoodMarket', input: { name: 'Time Out Market', venueCategory: 'FoodMarket' }, expected: ['food'] },
  { label: 'Apple Museum in My Restaurants', input: { name: 'Art Institute of Chicago', venueCategory: 'Museum' }, expected: [] },
  { label: 'Apple Store category', input: { name: 'Coffee Supply Co', venueCategory: 'Store' }, expected: [] },
  { label: 'Apple Hotel typed Bar', input: { name: 'The Robey', venueCategory: 'Hotel', placeTypes: ['Bar'] }, expected: ['drinks'] },
  { label: 'Apple Park', input: { name: 'Millennium Park', venueCategory: 'Park' }, expected: [] },
  { label: 'Unrecognised Apple category', input: { name: 'Lucky Strike', venueCategory: 'Bowling' }, expected: [] },

  // --- Older Mapbox-era category strings ---
  { label: 'Mapbox coffee shop', input: { name: 'Metric', venueCategory: 'coffee shop, café' }, expected: ['coffee'] },
  { label: 'Mapbox restaurant & bar', input: { name: 'Au Cheval', venueCategory: 'restaurant, bar' }, expected: ['food', 'drinks'] },
  { label: 'Mapbox sushi bar', input: { name: 'Kai Zan', venueCategory: 'sushi_bar' }, expected: ['food'] },
  { label: 'Mapbox tea house', input: { name: 'Teavana', venueCategory: 'tea_house' }, expected: ['coffee'] },
  { label: 'Mapbox espresso bar', input: { name: 'Hero', venueCategory: 'espresso bar' }, expected: ['coffee'] },
  { label: 'Accented Café category', input: { name: 'Lula', venueCategory: 'Café' }, expected: ['coffee'] },

  // --- Overlap ---
  { label: 'Café with brunch type', input: { name: 'Café Mustache', venueCategory: 'Cafe', placeTypes: ['Brunch'] }, expected: ['coffee', 'food'] },
  { label: 'Café with no food evidence', input: { name: 'Intelligentsia', venueCategory: 'Cafe', placeTypes: ['Cafe'] }, expected: ['coffee'] },
  { label: 'Restaurant typed Bar too', input: { name: 'Bar Siena', venueCategory: 'Restaurant', placeTypes: ['Dinner', 'Bar'] }, expected: ['food', 'drinks'] },
  { label: 'Brewpub', input: { name: 'Piece Brewery and Pizzeria', venueCategory: 'Brewery' }, expected: ['drinks', 'food'] },
  { label: 'Bakery café name', input: { name: 'Bakery Café Andersonville' }, expected: ['coffee', 'food'] },

  // --- Hand-typed (no category) ---
  { label: 'No category, coffee in name', input: { name: 'Intelligentsia Coffee' }, expected: ['coffee'] },
  { label: 'No category, roasters', input: { name: 'Dark Matter Coffee Roasters' }, expected: ['coffee'] },
  { label: 'No category, pizzeria', input: { name: "Pequod's Pizzeria" }, expected: ['food'] },
  { label: 'No category, taproom', input: { name: 'Hopewell Taproom' }, expected: ['drinks'] },
  { label: 'No category, brewing co', input: { name: 'Off Color Brewing' }, expected: ['drinks'] },
  { label: 'No category, cocktail lounge', input: { name: 'Kumiko Cocktail Lounge' }, expected: ['drinks'] },
  { label: 'No category, speakeasy', input: { name: 'The Drifter Speakeasy' }, expected: ['drinks'] },
  { label: 'No category, wine bar', input: { name: 'Income Tax Wine Bar' }, expected: ['drinks'] },
  { label: 'No category, sushi bar', input: { name: 'Sushi Bar Kaze' }, expected: ['food'] },
  { label: 'No category, oyster bar', input: { name: "Shaw's Oyster Bar" }, expected: ['food'] },
  { label: 'No category, juice bar', input: { name: 'Owen & Engine Juice Bar' }, expected: [] },
  // No category, no type, no tell-tale word: unknown, so Explore -> All only
  // (where it was saved never decides what it is).
  { label: 'No category, plain name', input: { name: 'Alinea' }, expected: [] },
  { label: 'Hand-typed cocktail bar, no category or type', input: { name: 'Kumiko' }, expected: [] },
  { label: 'Hand-typed café, no category or type', input: { name: 'Sawada' }, expected: [] },
  { label: 'No category, typed Cafe', input: { name: 'Bean Counter', placeTypes: ['Cafe'] }, expected: ['coffee'] },
  { label: 'No category, typed Bar', input: { name: 'Lost Lake', placeTypes: ['Bar'] }, expected: ['drinks'] },
  { label: 'No category, typed Date Night', input: { name: 'Elske', placeTypes: ['Date Night'] }, expected: [] },
  { label: 'Hand-typed cocktail bar, typed Bar', input: { name: 'Kumiko', placeTypes: ['Bar'] }, expected: ['drinks'] },
  // "Bar" in a venue's own name means a bar...
  { label: 'Bar in name (prefix)', input: { name: 'Bar Louie' }, expected: ['drinks'] },
  { label: 'Bar in name (suffix)', input: { name: 'The Owl Bar' }, expected: ['drinks'] },
  { label: 'Bar & Grill in name', input: { name: "Moe's Bar & Grill" }, expected: ['food', 'drinks'] },
  // ...except the non-drinking "... bar" phrases.
  { label: 'Genius Bar', input: { name: 'Genius Bar Michigan Ave' }, expected: [] },
  { label: 'Lash bar', input: { name: 'Lash Bar Studio' }, expected: [] },
  { label: 'Bar Method (fitness)', input: { name: 'The Bar Method' }, expected: [] },
  { label: 'Snack bar', input: { name: 'Beach Snack Bar' }, expected: ['food'] },
  // ...and in a list title it is still only supporting evidence.
  { label: 'Bar only in a list title', input: { name: 'Elske', listTitles: ['Bar crawl'] }, expected: [] },
  { label: 'Turkish kahvesi', input: { name: 'Kurukahveci Mehmet Efendi Kahvesi' }, expected: ['coffee'] },
  { label: 'Turkish lokanta', input: { name: 'Çiya Lokantası' }, expected: ['food'] },
  { label: 'Turkish meyhane', input: { name: 'Asmalı Meyhane' }, expected: ['food', 'drinks'] },
  { label: 'Plural cafes', input: { name: 'Two Cafes' }, expected: ['coffee'] },
  { label: 'Barbecue is not a bar', input: { name: "Smoque Barbecue" }, expected: ['food'] },
  // "Bar & Boeuf": a steakhouse with a real bar, so both.
  { label: 'Steakhouse with Bar in its name', input: { name: 'Bavette’s Bar & Boeuf Steakhouse' }, expected: ['food', 'drinks'] },

  // --- Not places or not food/drink ---
  { label: 'Coffee table book', input: { name: 'Coffee Table Design', listTitles: ['Coffee table books'] }, expected: [] },
  { label: 'Candy bar', input: { name: 'Candy Bar Taste Test' }, expected: [] },
  { label: 'Book in a reading list', input: { name: 'Salt Fat Acid Heat', listTitles: ['Books to read'] }, expected: [] },
];

/**
 * Known limitations, kept as fixtures so they are visible and so fixing one
 * is a deliberate change. `actual` is what the classifier returns today.
 */
export const KNOWN_LIMITATIONS: (PlaceFixture & { actual: PlaceCategoryId[]; why: string })[] = [
  {
    label: 'Café that serves full meals, no food type',
    input: { name: 'Lula Cafe', venueCategory: 'Cafe' },
    expected: ['coffee', 'food'],
    actual: ['coffee'],
    why: 'Apple says Cafe and nobody tagged it Lunch/Dinner/Brunch; "cafe" in a name is not food evidence.',
  },
  {
    label: 'Bar named after a food word',
    input: { name: 'The Sandwich Club', venueCategory: 'Nightlife' },
    expected: ['drinks'],
    actual: ['drinks', 'food'],
    why: 'A strong food word in the name (60) qualifies Food alongside the venue category.',
  },
  {
    label: 'Restaurant with "Bar" in its name, hand-typed',
    input: { name: 'Bar Siena' },
    expected: ['food', 'drinks'],
    actual: ['drinks'],
    why: '"Bar" in a name now means a bar (CP4 stabilization); nothing says it also serves food until Apple\'s category or a type does.',
  },
];
