import type { ClassificationInput, PlaceCategoryId } from '@/lib/placeClassification';

/**
 * HOLDOUT set: real venue names as people might type them into My
 * Restaurants by hand (no Apple category, no type). Written down BEFORE the
 * CP4 stabilization dictionary changes and NOT tuned against: the
 * classifier was not adjusted to make any of these pass.
 *
 * Unlike PLACE_FIXTURES (curated, all must pass), this set measures how
 * the classifier does on names it wasn't designed around. Its misses are
 * expected and reported, not hidden. A place with no category, no type and
 * no tell-tale word in its name *should* land in no category (Explore ->
 * All) - that is a correct "unknown", counted separately from a wrong one.
 */
export interface HoldoutPlace {
  input: ClassificationInput;
  /** What a person would say the place is ([] = not food or drink). */
  truth: PlaceCategoryId[];
}

const h = (name: string, truth: PlaceCategoryId[], venueCategory?: string): HoldoutPlace => ({
  input: { name, venueCategory },
  truth,
});

export const HOLDOUT_PLACES: HoldoutPlace[] = [
  // Bars & drinks
  h('Scofflaw', ['drinks']),
  h('The Whistler', ['drinks']),
  h('Billy Sunday', ['drinks']),
  h('Three Dots and a Dash', ['drinks']),
  h("Sportsman's Club", ['drinks']),
  h('Map Room', ['drinks']),
  h("Delilah's", ['drinks']),
  h('Rainbo Club', ['drinks']),
  h("Cindy's Rooftop", ['drinks']),
  h('Queen Mary Tavern', ['drinks']),
  h('Bar Pastoral', ['drinks']),
  h("Simone's Bar", ['drinks']),
  h('Old Town Ale House', ['drinks']),
  h('Goose Island Brewhouse', ['drinks']),
  h('Revolution Brewing', ['drinks']),
  h('Maplewood Brewery & Distillery', ['drinks']),
  h('The Long Room', ['drinks']),
  h('Pops for Champagne', ['drinks']),
  // Coffee & cafés
  h('Dollop', ['coffee']),
  h('Metric Coffee', ['coffee']),
  h('Gaslight Coffee Roasters', ['coffee']),
  h('Bow Truss', ['coffee']),
  h('Cafe Integral', ['coffee']),
  h('Sip of Hope', ['coffee']),
  h('Big Shoulders Coffee', ['coffee']),
  h('Kopi Cafe', ['coffee']),
  h('La Colombe', ['coffee']),
  // Food & restaurants
  h('Monteverde', ['food']),
  h('Smyth', ['food']),
  h('Kasama', ['food']),
  h('Lao Sze Chuan', ['food']),
  h("Portillo's", ['food']),
  h("Lou Malnati's Pizzeria", ['food']),
  h('Xoco', ['food']),
  h("Dove's Luncheonette", ['food']),
  h('Avec', ['food']),
  h('Superdawg Drive-In', ['food']),
  h('Mi Tocaya Antojeria', ['food']),
  h('Birrieria Zaragoza', ['food']),
  h('Pho 777', ['food']),
  h('Ramen-san', ['food']),
  h('Tortello', ['food']),
  h("Hot Doug's", ['food']),
  // Not food or drink
  h('Wicker Park', []),
  h('Bar Method Lincoln Park', []),
  h('Barnes & Noble', []),
  h("Barbara's Bookstore", []),
  h("Trader Joe's", []),
  h('The Coffee Table Book of Dogs', []),
  // The same kind of places as people save them today, with Apple's category
  h('Scofflaw', ['drinks'], 'Nightlife'),
  h('Dollop', ['coffee'], 'Cafe'),
  h('Kasama', ['food', 'coffee'], 'Bakery'),
  h('Avec', ['food'], 'Restaurant'),
  h("Trader Joe's", [], 'FoodMarket'),
  h('Wicker Park', [], 'Park'),
];
