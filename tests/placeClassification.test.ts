import { describe, expect, it } from 'vitest';
import {
  classifyPlace,
  isLocatablePlace,
  normalizeWords,
  QUALIFY_SCORE,
  SOURCE_WEIGHT,
} from '@/lib/placeClassification';
import { KNOWN_LIMITATIONS, PLACE_FIXTURES } from './fixtures/discoveryPlaces';
import { HOLDOUT_PLACES } from './fixtures/holdoutPlaces';

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
    expect(cats({ name: 'Lost Lake', placeTypes: ['Bar'], listTitles: ['Weekend Plans'] })).toEqual(['drinks']);
  });

  it('4. a café with real food evidence is Food and Coffee; without it, Coffee only', () => {
    expect(cats({ name: 'Café Mustache', venueCategory: 'Cafe', placeTypes: ['Brunch'] })).toEqual(['coffee', 'food']);
    expect(cats({ name: 'Café Mustache', venueCategory: 'Cafe' })).toEqual(['coffee']);
  });

  it('5. a place with no category, no type and no tell-tale name stays uncategorised (Explore -> All)', () => {
    // My Restaurants holds cafés and bars too, so where it was saved decides nothing.
    for (const name of ['Alinea', 'Kumiko', 'Sawada', 'Elske']) {
      const r = classifyPlace({ name });
      expect(r.categories, name).toEqual([]);
      expect(r.primary).toBeNull();
      expect(r.reason).toBe('none: no evidence reached the threshold');
    }
    // A restaurant still gets in through any real evidence.
    expect(cats({ name: 'Alinea', venueCategory: 'Restaurant' })).toEqual(['food']);
    expect(cats({ name: 'Alinea', placeTypes: ['Dinner'] })).toEqual(['food']);
  });

  it('5b. an unfamiliar hand-typed cocktail bar is not guessed as Food', () => {
    expect(cats({ name: 'Kumiko' })).toEqual([]);
    expect(cats({ name: 'Kumiko', placeTypes: ['Bar'] })).toEqual(['drinks']);
    expect(cats({ name: 'Kumiko', venueCategory: 'Nightlife' })).toEqual(['drinks']);
    expect(cats({ name: 'Kumiko Cocktail Lounge' })).toEqual(['drinks']);
  });

  it('6. an unknown or non-food venue never defaults to Food', () => {
    expect(cats({ name: 'Art Institute', venueCategory: 'Museum' })).toEqual([]);
    expect(cats({ name: 'Lucky Strike', venueCategory: 'Bowling' })).toEqual([]);
    expect(cats({ name: 'Somewhere', venueCategory: 'SomeNewAppleCategory' })).toEqual([]);
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

  it('"Bar" in a venue name means a bar; other generic words are not enough on their own', () => {
    expect(cats({ name: "Simone's Bar" })).toEqual(['drinks']);
    expect(cats({ name: 'Bar Siena' })).toEqual(['drinks']);
    expect(classifyPlace({ name: 'Bar Siena' }).scores.drinks).toBe(SOURCE_WEIGHT.name);
    // Non-drinking "... bar" phrases are matched first.
    for (const name of ['Genius Bar', 'Nail Bar Wicker Park', 'The Bar Method', 'Candy Bar Taste Test', 'Juice Bar']) {
      expect(cats({ name }), name).not.toContain('drinks');
    }
    expect(cats({ name: 'Sushi Bar Kaze' })).toEqual(['food']);
    // "lounge", "kitchen", "wine" stay half-strength in names.
    expect(cats({ name: 'The Lounge' })).toEqual([]);
    expect(cats({ name: 'Mom’s Kitchen' })).toEqual([]);
    expect(cats({ name: 'Wine Shop Andersonville' })).toEqual([]);
    expect(classifyPlace({ name: 'The Lounge' }).scores.drinks).toBeLessThan(QUALIFY_SCORE);
    // In a list title "bar" is only supporting evidence.
    expect(cats({ name: 'Elske', listTitles: ['Bar crawl'] })).toEqual([]);
    // A type someone chose always counts fully.
    expect(cats({ name: 'The Lounge', placeTypes: ['Lounge'] })).toEqual(['drinks']);
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
      "food: venue category 'Restaurant' matched \"restaurant\" (score 100); drinks: type 'Bar' matched \"bar\" (score 140)",
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

/**
 * Holdout: names the dictionary was not tuned against (see
 * fixtures/holdoutPlaces.ts). Reported separately from the curated set.
 * The numbers below are a snapshot of measured behaviour, so any change -
 * better or worse - shows up as a test diff to review deliberately.
 *
 *   wrong     = a category it is NOT (false positive)
 *   missed    = a category it IS, not found, while other evidence existed
 *   unknown   = no category at all (shown under All) - the honest outcome
 *               when nothing says what the place is
 */
describe('holdout evaluation (not tuned)', () => {
  const rows = HOLDOUT_PLACES.map((h) => {
    const got = classifyPlace(h.input).categories;
    return {
      name: h.input.name + (h.input.venueCategory ? ` [${h.input.venueCategory}]` : ''),
      truth: h.truth,
      got,
      wrong: got.filter((c) => !h.truth.includes(c)),
      missing: h.truth.filter((c) => !got.includes(c)),
    };
  });

  it('measured results', () => {
    const exact = rows.filter((r) => r.wrong.length === 0 && r.missing.length === 0).length;
    const falsePositives = rows.filter((r) => r.wrong.length > 0).map((r) => `${r.name}: ${r.wrong.join('+')}`);
    const unknown = rows.filter((r) => r.got.length === 0 && r.truth.length > 0).map((r) => r.name);
    const partial = rows
      .filter((r) => r.got.length > 0 && r.missing.length > 0)
      .map((r) => `${r.name}: missing ${r.missing.join('+')}`);
    expect({ total: rows.length, exact, falsePositives, partial, unknown }).toMatchSnapshot();
  });
});
