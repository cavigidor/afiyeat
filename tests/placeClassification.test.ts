import { describe, expect, it } from 'vitest';
import {
  classifyPlace,
  isLocatablePlace,
  normalizeWords,
  QUALIFY_SCORE,
  SOURCE_WEIGHT,
} from '@/lib/placeClassification';
import { KNOWN_LIMITATIONS, PLACE_FIXTURES } from './fixtures/discoveryPlaces';

const cats = (input: Parameters<typeof classifyPlace>[0]) => classifyPlace(input).categories;

describe('required CP4 cases', () => {
  it('1. a restaurant saved in an unrelated list is Food', () => {
    expect(cats({ name: 'Girl & the Goat', venueCategory: 'Restaurant', listTitles: ['Best Date Nights'] })).toEqual(['food']);
  });

  it('2. a coffee shop under a generic list name is Coffee', () => {
    expect(cats({ name: 'Sawada Coffee', venueCategory: 'Cafe', listTitles: ['Chicago Favorites'] })).toEqual(['coffee']);
  });

  it('3. a bar with no "bar" in the list title is Drinks', () => {
    expect(cats({ name: 'The Violet Hour', venueCategory: 'Nightlife', listTitles: ['Weekend Plans'] })).toEqual(['drinks']);
    expect(cats({ name: 'Lost Lake', placeTypes: ['Bar'], listTitles: ['Weekend Plans'], collection: 'restaurants' })).toEqual(['drinks']);
  });

  it('4. a café with real food evidence is Food and Coffee; without it, Coffee only', () => {
    expect(cats({ name: 'Café Mustache', venueCategory: 'Cafe', placeTypes: ['Brunch'] })).toEqual(['coffee', 'food']);
    expect(cats({ name: 'Café Mustache', venueCategory: 'Cafe' })).toEqual(['coffee']);
  });

  it('5. a My Restaurants place with no category at all is Food (the only fallback)', () => {
    const r = classifyPlace({ name: 'Alinea', collection: 'restaurants' });
    expect(r.categories).toEqual(['food']);
    expect(r.strongest.food?.source).toBe('collection');
    expect(r.tier.food).toBe(6);
    // ...but not for anything that isn't My Restaurants.
    expect(cats({ name: 'Alinea', collection: 'custom_list' })).toEqual([]);
    expect(cats({ name: 'Alinea' })).toEqual([]);
  });

  it('6. an unknown or non-food venue never defaults to Food', () => {
    expect(cats({ name: 'Art Institute', venueCategory: 'Museum', collection: 'restaurants' })).toEqual([]);
    expect(cats({ name: 'Lucky Strike', venueCategory: 'Bowling', collection: 'restaurants' })).toEqual([]);
    expect(cats({ name: 'Somewhere', venueCategory: 'SomeNewAppleCategory', collection: 'restaurants' })).toEqual([]);
    expect(classifyPlace({ name: 'Art Institute', venueCategory: 'Museum' }).reason).toMatch(/not food or drink/);
  });

  it('7. a coffee-related book is not a café', () => {
    expect(cats({ name: 'Coffee Table Design', listTitles: ['Coffee table books'] })).toEqual([]);
    // And without a location it never reaches place discovery at all.
    expect(isLocatablePlace({ apple_place_id: null, address: null, latitude: null, longitude: null })).toBe(false);
  });

  it('8. a restaurant comment mentioning coffee does not make it a café', () => {
    expect(cats({ name: 'Au Cheval', venueCategory: 'Restaurant', notes: ['Great coffee after dinner', 'coffee!'] })).toEqual(['food']);
    // Even with no category: notes alone (10) are far below the threshold.
    expect(classifyPlace({ name: 'Alinea', notes: ['coffee', 'espresso', 'latte'] }).scores.coffee).toBe(SOURCE_WEIGHT.notes);
  });

  it('9. strong establishment-name aliases classify hand-typed places', () => {
    expect(cats({ name: 'Intelligentsia Coffee' })).toEqual(['coffee']);
    expect(cats({ name: 'Hopewell Taproom' })).toEqual(['drinks']);
    expect(cats({ name: "Pequod's Pizzeria" })).toEqual(['food']);
    expect(cats({ name: 'Dark Matter Coffee Roasters' })).toEqual(['coffee']);
    expect(cats({ name: 'The Drifter Speakeasy' })).toEqual(['drinks']);
  });

  it('10. synonyms, accents, capitalisation and word boundaries', () => {
    expect(cats({ venueCategory: 'CAFÉ' })).toEqual(['coffee']);
    expect(cats({ venueCategory: 'caffè' })).toEqual(['coffee']);
    expect(cats({ name: 'Çiya Lokantası' })).toEqual(['food']);
    expect(cats({ name: 'Kurukahveci Mehmet Efendi Kahvesi' })).toEqual(['coffee']);
    expect(cats({ venueCategory: 'FoodMarket' })).toEqual(['food']);
    expect(cats({ venueCategory: 'coffee_shop' })).toEqual(['coffee']);
    // Whole words only: "bar" is not in barbecue / barber / Barcelona, "tea" not in steak.
    expect(cats({ name: 'Smoque Barbecue' })).toEqual(['food']);
    expect(cats({ name: 'Barber Shop Barcelona' })).toEqual([]);
    expect(cats({ name: 'Steak 48' })).toEqual([]);
    // Phrases win over their parts.
    expect(cats({ name: 'Sushi Bar Kaze' })).toEqual(['food']);
    expect(cats({ name: 'Espresso Bar Hero' })).toEqual(['coffee']);
    expect(cats({ name: 'Candy Bar Taste Test' })).toEqual([]);
    // Plurals.
    expect(cats({ name: 'Two Cafes' })).toEqual(['coffee']);
    expect(normalizeWords('Breweries & Pubs')).toEqual(['brewery', 'and', 'pub']);
  });

  it('a generic word ("bar", "lounge", "kitchen") in a name is not enough on its own', () => {
    expect(classifyPlace({ name: 'Bar Siena' }).scores.drinks).toBeLessThan(QUALIFY_SCORE);
    expect(cats({ name: 'Bar Siena' })).toEqual([]);
    expect(cats({ name: 'The Lounge' })).toEqual([]);
    expect(cats({ name: 'Mom’s Kitchen' })).toEqual([]);
    // ...but a type someone chose counts fully.
    expect(cats({ name: 'Bar Siena', placeTypes: ['Bar'] })).toEqual(['drinks']);
  });

  it('a list title is supporting evidence only', () => {
    expect(cats({ name: 'Bean Counter', listTitles: ['Coffee spots'] })).toEqual([]);
    expect(cats({ name: 'Bean Counter', listTitles: ['Coffee spots', 'Best coffee', 'More coffee'] })).toEqual([]);
    // A list title "Date Night" says nothing about what a place is.
    expect(classifyPlace({ name: 'Elske', listTitles: ['Date Night'] }).evidence).toEqual([]);
  });

  it('a non-food venue category blocks names and titles but not a chosen type', () => {
    expect(cats({ name: 'Coffee Supply Co', venueCategory: 'Store' })).toEqual([]);
    expect(cats({ name: 'The Robey', venueCategory: 'Hotel', placeTypes: ['Bar'] })).toEqual(['drinks']);
  });

  it('explains every decision', () => {
    const r = classifyPlace({ name: 'Bar Siena', venueCategory: 'Restaurant', placeTypes: ['Bar'] });
    expect(r.categories).toEqual(['food', 'drinks']);
    expect(r.strongest.food).toMatchObject({ source: 'venue_category', term: 'restaurant' });
    expect(r.strongest.drinks).toMatchObject({ source: 'place_type', term: 'bar' });
    expect(r.tier).toEqual({ food: 1, drinks: 2 });
    expect(r.reason).toBe(
      "food: venue category 'Restaurant' matched \"restaurant\" (score 100); drinks: type 'Bar' matched \"bar\" (score 110)",
    );
  });

  it('is deterministic', () => {
    const input = { name: 'Piece Brewery and Pizzeria', venueCategory: 'Brewery', placeTypes: ['Dinner', 'Bar'] };
    expect(classifyPlace(input)).toEqual(classifyPlace({ ...input }));
  });
});

describe('fixture evaluation', () => {
  it.each(PLACE_FIXTURES.map((f) => [f.label, f] as const))('%s', (_label, fixture) => {
    const result = classifyPlace(fixture.input);
    expect(result.categories, result.reason).toEqual(fixture.expected);
  });

  it('has no false positives or negatives across the fixture set', () => {
    let falsePositives = 0;
    let falseNegatives = 0;
    for (const f of PLACE_FIXTURES) {
      const got = classifyPlace(f.input).categories;
      falsePositives += got.filter((c) => !f.expected.includes(c)).length;
      falseNegatives += f.expected.filter((c) => !got.includes(c)).length;
    }
    expect({ fixtures: PLACE_FIXTURES.length, falsePositives, falseNegatives }).toEqual({
      fixtures: PLACE_FIXTURES.length,
      falsePositives: 0,
      falseNegatives: 0,
    });
  });

  it.each(KNOWN_LIMITATIONS.map((f) => [f.label, f] as const))('known limitation: %s', (_label, f) => {
    expect(classifyPlace(f.input).categories).toEqual(f.actual);
    expect(f.actual).not.toEqual(f.expected);
  });
});
