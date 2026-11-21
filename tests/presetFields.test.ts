import { describe, expect, it } from 'vitest';
import { FIELD_CATALOGUE, fieldsForPreset, mergePresetFields, NAME_LABELS, PRESET_FIELDS, uiOf, visibleFields, type FieldDef } from '@/lib/presetFields';
import { compactValues, detailSummary, formatValue, isMissingTable, validateValues } from '@/lib/itemDetails';
import { MORE_PRESETS, V2_PRESETS } from '@/lib/listPresets';

const ALL = [...V2_PRESETS, ...MORE_PRESETS];
const mainOf = (key: string, cats: string[] = []) => visibleFields(fieldsForPreset(key), key, cats).filter((f) => uiOf(f).tier === 'main');
const def = (key: string) => fieldsForPreset(Object.keys(PRESET_FIELDS).find((p) => PRESET_FIELDS[p].includes(key))!).find((f) => f.key === key)!;

describe('field catalogue', () => {
  it('covers all twelve presets with 2-3 main fields each (Drinks: per category) and an optional rest', () => {
    for (const p of ALL) {
      if (p.key === 'drinks') {
        for (const cat of ['Beer', 'Wine', 'Spirits']) expect(mainOf('drinks', [cat]).length, cat).toBeGreaterThanOrEqual(2);
        for (const cat of ['Beer', 'Wine', 'Cocktails', 'Spirits']) expect(mainOf('drinks', [cat]).length, cat).toBeLessThanOrEqual(3);
        continue;
      }
      expect(mainOf(p.key).length, p.key).toBeGreaterThanOrEqual(2);
      expect(mainOf(p.key).length, p.key).toBeLessThanOrEqual(3);
    }
  });

  it('keys are unique, well formed and stay under the 30-field limit', () => {
    for (const [k, e] of Object.entries(FIELD_CATALOGUE)) {
      expect(e.key).toBe(k);
      expect(k).toMatch(/^c_[a-z][a-z0-9_]{0,37}$/);
      if (e.type === 'choice' || e.type === 'multi') expect(new Set(e.options).size).toBe(e.options!.length);
    }
    for (const [p, keys] of Object.entries(PRESET_FIELDS)) {
      expect(new Set(keys).size, p).toBe(keys.length);
      expect(keys.length, p).toBeLessThanOrEqual(30);
      for (const k of keys) expect(FIELD_CATALOGUE[k], `${p}.${k}`).toBeTruthy();
    }
  });

  it('Coffee Beans: coffee name as the title, a separate Roaster, exactly six roasts, Best for as multi-select, taste tags with custom text', () => {
    expect(NAME_LABELS.coffee_beans).toBe('Coffee name');
    expect(mainOf('coffee_beans').map((f) => f.label)).toEqual(['Roaster', 'Roast', 'Taste profile']);
    expect(def('c_roast')).toMatchObject({ type: 'choice', options: ['Light', 'Light-Medium', 'Medium', 'Medium-Dark', 'Dark', 'Extra Dark'] });
    expect(def('c_best_for')).toMatchObject({ type: 'multi', options: ['Espresso', 'Pour-over', 'Cold Brew', 'Other'] });
    expect(def('c_taste_profile').type).toBe('tags');
    expect(uiOf(def('c_taste_profile')).suggestions!.length).toBeGreaterThan(3);
  });

  it('Wines: colour and style are separate; vineyard, producer, name, grapes, vintage and region are offered', () => {
    const wine = fieldsForPreset('wines');
    expect(wine.find((f) => f.key === 'c_wine_color')?.options).toEqual(['Red', 'White', 'Rosé', 'Orange']);
    expect(wine.find((f) => f.key === 'c_wine_style')?.options).toEqual(['Still', 'Sparkling', 'Dessert', 'Fortified']);
    expect(wine.map((f) => f.label)).toEqual(expect.arrayContaining(['Vineyard', 'Producer', 'Wine name', 'Grapes', 'Vintage', 'Region']));
  });

  it('Beers: brewery and a style dropdown first; ABV, IBU and taste optional', () => {
    expect(mainOf('beers').map((f) => f.label)).toEqual(['Brewery', 'Style']);
    expect(def('c_beer_style').type).toBe('choice');
    expect(fieldsForPreset('beers').filter((f) => uiOf(f).tier === 'more').map((f) => f.label)).toEqual(['ABV', 'IBU', 'Taste']);
  });

  it('Drinks shows beer fields on a beer, wine fields on a wine, and none of either otherwise', () => {
    const labels = (cats: string[]) => visibleFields(fieldsForPreset('drinks'), 'drinks', cats).map((f) => f.key);
    expect(labels(['Beer'])).toContain('c_brewery');
    expect(labels(['Beer'])).not.toContain('c_vintage');
    expect(labels(['Wine'])).toContain('c_vintage');
    expect(labels([])).toEqual(['c_abv']);
  });

  it('hidden fields are not offered, but Wines and Beers lists show their fields whatever the category', () => {
    const f = fieldsForPreset('beers').map((x) => (x.key === 'c_ibu' ? { ...x, hidden: true } : x));
    expect(visibleFields(f, 'beers', []).map((x) => x.key)).not.toContain('c_ibu');
    expect(visibleFields(f, 'beers', []).map((x) => x.key)).toContain('c_brewery');
  });

  it('adding fields to an existing list keeps what it has, and hides Roast where roast categories are already used', () => {
    const existing: FieldDef[] = [{ key: 'c_roaster', label: 'My roaster', type: 'text', hidden: true }];
    const merged = mergePresetFields(existing, 'coffee_beans', ['Light roast', 'Medium roast', 'Dark roast']);
    expect(merged[0]).toEqual(existing[0]);
    expect(merged.find((f) => f.key === 'c_roast')?.hidden).toBe(true);
    expect(merged.filter((f) => f.key === 'c_roaster')).toHaveLength(1);
    expect(mergePresetFields([], 'coffee_beans', []).find((f) => f.key === 'c_roast')?.hidden).toBeUndefined();
  });
});

describe('values', () => {
  const coffee = fieldsForPreset('coffee_beans');
  it('drops empty fields and trims text', () => {
    expect(compactValues({ c_roaster: '  Tide ', c_origin: '', c_taste_profile: [], c_roast: 'Dark' })).toEqual({ c_roaster: 'Tide', c_roast: 'Dark' });
  });
  it('checks types like the database does', () => {
    expect(validateValues(coffee, { c_roast: 'Burnt', c_best_for: ['Espresso', 'Turkish'], c_roast_date: '2026-02-30' })).toEqual({
      c_roast: 'Pick one of the options', c_best_for: 'Pick from the options', c_roast_date: 'Pick a date',
    });
    expect(validateValues(coffee, { c_roast: 'Extra Dark', c_best_for: ['Cold Brew'], c_roast_date: '2026-11-02', c_taste_profile: ['Jasmine'] })).toEqual({});
    expect(validateValues(fieldsForPreset('wines'), { c_vintage: 19 })).toEqual({ c_vintage: 'Between 1800 and 2100' });
  });
  it('reads well in the list row and on the item', () => {
    expect(detailSummary(coffee, { c_roast: 'Light', c_roaster: 'Tide Roasters', c_origin: 'Ethiopia' })).toBe('Tide Roasters · Light');
    expect(detailSummary(coffee, {})).toBe('');
    expect(formatValue(def('c_abv'), 5.2)).toBe('5.2%');
    expect(formatValue(def('c_taste_profile'), ['Fruity', 'Jasmine'])).toBe('Fruity, Jasmine');
  });
  it('treats a missing table as "not available"', () => {
    expect(isMissingTable({ code: 'PGRST205', message: "Could not find the table 'public.custom_list_owner_settings'" }, 404)).toBe(true);
    expect(isMissingTable({ code: '42501', message: 'permission denied' }, 403)).toBe(false);
  });
});
