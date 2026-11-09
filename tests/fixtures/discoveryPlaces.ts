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

const R = 'restaurants' as const;

export const PLACE_FIXTURES: PlaceFixture[] = [
  // --- Apple venue categories ---
  { label: 'Apple Restaurant', input: { name: 'Girl & the Goat', venueCategory: 'Restaurant', collection: R }, expected: ['food'] },
  { label: 'Apple Cafe', input: { name: 'Sawada Coffee', venueCategory: 'Cafe', collection: R }, expected: ['coffee'] },
  { label: 'Apple Nightlife', input: { name: 'The Violet Hour', venueCategory: 'Nightlife', collection: R }, expected: ['drinks'] },
  { label: 'Apple Brewery', input: { name: 'Half Acre', venueCategory: 'Brewery', collection: R }, expected: ['drinks'] },
  { label: 'Apple Winery', input: { name: 'City Winery', venueCategory: 'Winery', collection: R }, expected: ['drinks'] },
  { label: 'Apple Distillery', input: { name: 'KOVAL', venueCategory: 'Distillery', collection: R }, expected: ['drinks'] },
  { label: 'Apple Bakery', input: { name: 'Hewn', venueCategory: 'Bakery', collection: R }, expected: ['food'] },
  { label: 'Apple FoodMarket', input: { name: 'Time Out Market', venueCategory: 'FoodMarket', collection: R }, expected: ['food'] },
  { label: 'Apple Museum in My Restaurants', input: { name: 'Art Institute of Chicago', venueCategory: 'Museum', collection: R }, expected: [] },
  { label: 'Apple Store category', input: { name: 'Coffee Supply Co', venueCategory: 'Store', collection: R }, expected: [] },
  { label: 'Apple Hotel typed Bar', input: { name: 'The Robey', venueCategory: 'Hotel', placeTypes: ['Bar'], collection: R }, expected: ['drinks'] },
  { label: 'Apple Park', input: { name: 'Millennium Park', venueCategory: 'Park', collection: R }, expected: [] },
  { label: 'Unrecognised Apple category', input: { name: 'Lucky Strike', venueCategory: 'Bowling', collection: R }, expected: [] },

  // --- Older Mapbox-era category strings ---
  { label: 'Mapbox coffee shop', input: { name: 'Metric', venueCategory: 'coffee shop, café', collection: R }, expected: ['coffee'] },
  { label: 'Mapbox restaurant & bar', input: { name: 'Au Cheval', venueCategory: 'restaurant, bar', collection: R }, expected: ['food', 'drinks'] },
  { label: 'Mapbox sushi bar', input: { name: 'Kai Zan', venueCategory: 'sushi_bar', collection: R }, expected: ['food'] },
  { label: 'Mapbox tea house', input: { name: 'Teavana', venueCategory: 'tea_house', collection: R }, expected: ['coffee'] },
  { label: 'Mapbox espresso bar', input: { name: 'Hero', venueCategory: 'espresso bar', collection: R }, expected: ['coffee'] },
  { label: 'Accented Café category', input: { name: 'Lula', venueCategory: 'Café', collection: R }, expected: ['coffee'] },

  // --- Overlap ---
  { label: 'Café with brunch type', input: { name: 'Café Mustache', venueCategory: 'Cafe', placeTypes: ['Brunch'], collection: R }, expected: ['coffee', 'food'] },
  { label: 'Café with no food evidence', input: { name: 'Intelligentsia', venueCategory: 'Cafe', placeTypes: ['Cafe'], collection: R }, expected: ['coffee'] },
  { label: 'Restaurant typed Bar too', input: { name: 'Bar Siena', venueCategory: 'Restaurant', placeTypes: ['Dinner', 'Bar'], collection: R }, expected: ['food', 'drinks'] },
  { label: 'Brewpub', input: { name: 'Piece Brewery and Pizzeria', venueCategory: 'Brewery', collection: R }, expected: ['drinks', 'food'] },
  { label: 'Bakery café name', input: { name: 'Bakery Café Andersonville', collection: R }, expected: ['coffee', 'food'] },

  // --- Hand-typed (no category) ---
  { label: 'No category, coffee in name', input: { name: 'Intelligentsia Coffee', collection: R }, expected: ['coffee'] },
  { label: 'No category, roasters', input: { name: 'Dark Matter Coffee Roasters', collection: R }, expected: ['coffee'] },
  { label: 'No category, pizzeria', input: { name: "Pequod's Pizzeria", collection: R }, expected: ['food'] },
  { label: 'No category, taproom', input: { name: 'Hopewell Taproom', collection: R }, expected: ['drinks'] },
  { label: 'No category, brewing co', input: { name: 'Off Color Brewing', collection: R }, expected: ['drinks'] },
  { label: 'No category, cocktail lounge', input: { name: 'Kumiko Cocktail Lounge', collection: R }, expected: ['drinks'] },
  { label: 'No category, speakeasy', input: { name: 'The Drifter Speakeasy', collection: R }, expected: ['drinks'] },
  { label: 'No category, wine bar', input: { name: 'Income Tax Wine Bar', collection: R }, expected: ['drinks'] },
  { label: 'No category, sushi bar', input: { name: 'Sushi Bar Kaze', collection: R }, expected: ['food'] },
  { label: 'No category, oyster bar', input: { name: "Shaw's Oyster Bar", collection: R }, expected: ['food'] },
  { label: 'No category, juice bar', input: { name: 'Owen & Engine Juice Bar', collection: R }, expected: ['food'] },
  { label: 'No category, plain name', input: { name: 'Alinea', collection: R }, expected: ['food'] },
  { label: 'No category, typed Cafe', input: { name: 'Bean Counter', placeTypes: ['Cafe'], collection: R }, expected: ['coffee'] },
  { label: 'No category, typed Bar', input: { name: 'Lost Lake', placeTypes: ['Bar'], collection: R }, expected: ['drinks'] },
  { label: 'No category, typed Date Night', input: { name: 'Elske', placeTypes: ['Date Night'], collection: R }, expected: ['food'] },
  { label: 'Turkish kahvesi', input: { name: 'Kurukahveci Mehmet Efendi Kahvesi', collection: R }, expected: ['coffee'] },
  { label: 'Turkish lokanta', input: { name: 'Çiya Lokantası', collection: R }, expected: ['food'] },
  { label: 'Turkish meyhane', input: { name: 'Asmalı Meyhane', collection: R }, expected: ['food', 'drinks'] },
  { label: 'Plural cafes', input: { name: 'Two Cafes', collection: R }, expected: ['coffee'] },
  { label: 'Barbecue is not a bar', input: { name: "Smoque Barbecue", collection: R }, expected: ['food'] },
  { label: 'Steakhouse', input: { name: 'Bavette’s Bar & Boeuf Steakhouse', collection: R }, expected: ['food'] },

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
    label: 'Hand-typed cocktail bar with no category, type or tell-tale name',
    input: { name: 'Kumiko', collection: R },
    expected: ['drinks'],
    actual: ['food'],
    why: 'Nothing but the My Restaurants fallback is known; the owner adding a "Bar" type fixes it.',
  },
  {
    label: 'Café that serves full meals, no food type',
    input: { name: 'Lula Cafe', venueCategory: 'Cafe', collection: R },
    expected: ['coffee', 'food'],
    actual: ['coffee'],
    why: 'Apple says Cafe and nobody tagged it Lunch/Dinner/Brunch; "cafe" in a name is not food evidence.',
  },
  {
    label: 'Bar named after a food word',
    input: { name: 'The Sandwich Club', venueCategory: 'Nightlife', collection: R },
    expected: ['drinks'],
    actual: ['drinks', 'food'],
    why: 'A strong food word in the name (60) qualifies Food alongside the venue category.',
  },
];
