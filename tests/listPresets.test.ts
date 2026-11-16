import { describe, expect, it } from 'vitest';
import { defaultViewOf, layoutOf, MORE_PRESETS, nounOf, presetForIcon, V2_PRESETS, viewsFor } from '@/lib/listPresets';
import { categoriesOf, groupByCategory, subtitleOf } from '@/lib/listItemDisplay';
import type { CustomList } from '@/components/lists/CreateListDialog';
import type { CustomListItem } from '@/components/lists/AddCustomListItemDialog';

const list = (over: Partial<CustomList>): CustomList => ({
  id: 'l', name: 'L', icon: '📋', color: '#000', show_location: false, show_price: false, price_mode: 'dollar',
  show_rating: false, rating_mode: 'scale_10', show_notes: true, show_photos: true, status_todo_label: '', status_done_label: '', ...over,
});
const item = (over: Partial<CustomListItem>): CustomListItem => ({
  id: 'i', list_id: 'l', name: 'X', address: null, latitude: null, longitude: null, price_level: null, price_manual: null,
  rating: null, rating_manual: null, notes: null, status_id: 's', type_id: null, type_ids: [], ...over,
});
const types = [
  { id: 't1', name: 'Wine', color: '#800', icon: '🍷', list_id: 'l', user_id: 'u', sort_order: 0, created_at: '' },
  { id: 't2', name: 'Beer', color: '#cc0', icon: null, list_id: 'l', user_id: 'u', sort_order: 1, created_at: '' },
];

describe('presets', () => {
  it('six V2 presets, older presets kept, every icon unique', () => {
    expect(V2_PRESETS.map((p) => p.key)).toEqual(['restaurants', 'drinks', 'coffee_beans', 'coffee_shops', 'stores', 'travel']);
    expect(MORE_PRESETS.map((p) => p.label)).toEqual(['Movies', 'Shows', 'Books', 'Concerts', 'Wines', 'Beers']);
    const icons = [...V2_PRESETS, ...MORE_PRESETS].map((p) => p.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
  it('only Travel overrides the default audience', () => {
    expect(V2_PRESETS.filter((p) => p.visibility).map((p) => [p.key, p.visibility])).toEqual([['travel', 'private']]);
  });
  it('every preset has at least one status, and price/rating styles that exist in the database', () => {
    for (const p of [...V2_PRESETS, ...MORE_PRESETS]) {
      expect(p.statuses.length).toBeGreaterThan(0);
      expect(['dollar', 'manual']).toContain(p.config.price_mode);
      expect(['scale_10', 'stars_5', 'manual']).toContain(p.config.rating_mode);
    }
  });
});

describe('layout of existing lists (no conversion)', () => {
  it('a preset icon decides the layout, including lists made before V2', () => {
    expect(layoutOf(list({ icon: '🍷' }))).toBe('tasting'); // old Wines preset
    expect(layoutOf(list({ icon: '☕', show_location: true }))).toBe('places'); // old Coffee Shops
    expect(layoutOf(list({ icon: '📚' }))).toBe('collection');
    expect(layoutOf(list({ icon: '🌍' }))).toBe('travel');
  });
  it('a list with any other icon is laid out from its own fields', () => {
    expect(layoutOf(list({ icon: '🎁', show_location: true }))).toBe('places');
    expect(layoutOf(list({ icon: '🎁', show_rating: true, show_photos: true }))).toBe('tasting');
    expect(layoutOf(list({ icon: '🎁' }))).toBe('collection');
    expect(presetForIcon('📋')).toBeNull();
  });
  it('nouns and default views', () => {
    expect(nounOf(list({ icon: '🍸' }))).toEqual({ one: 'drink', many: 'drinks' });
    expect(nounOf(list({ icon: '🎁' }))).toEqual({ one: 'item', many: 'items' });
    expect(defaultViewOf(list({ icon: '🌍' }))).toBe('grouped');
    expect(defaultViewOf(list({ icon: '🎁' }))).toBe('list');
  });
});

describe('views', () => {
  it('offers only what the data supports, with a reason otherwise', () => {
    const v = viewsFor(list({ show_location: false, show_photos: true }), { categories: 0, withPhotos: 0, withCoords: 3 });
    const by = Object.fromEntries(v.map((o) => [o.view, o]));
    expect(by.list.available).toBe(true);
    expect(by.cards).toMatchObject({ available: false, reason: 'Add a photo to use this view' });
    expect(by.grouped).toMatchObject({ available: false });
    expect(by.map).toMatchObject({ available: false, reason: 'Turn on Location in Customize to use this view' });
    const v2 = viewsFor(list({ show_location: true, show_photos: true }), { categories: 2, withPhotos: 1, withCoords: 1 });
    expect(v2.every((o) => o.available)).toBe(true);
  });
});

describe('rows and groups', () => {
  it('subtitle shows only what the item has', () => {
    expect(subtitleOf(item({}), list({}), types)).toBe('');
    expect(subtitleOf(item({ type_ids: ['t2', 't1'], price_manual: 12 }), list({ show_price: true, price_mode: 'manual' }), types)).toBe('Wine, Beer · $12');
    expect(subtitleOf(item({ address: '1 Main St, Chicago', price_level: 2 }), list({ show_location: true, show_price: true }), types)).toBe('$$ · 1 Main St');
    // A hidden field is not shown even when the item has a value.
    expect(subtitleOf(item({ address: '1 Main St', price_level: 2 }), list({ show_location: false, show_price: false }), types)).toBe('');
  });
  it('older single-category items (type_id only) still count', () => {
    expect(categoriesOf(item({ type_id: 't2', type_ids: [] }), types).map((t) => t.name)).toEqual(['Beer']);
  });
  it('groups follow category order; uncategorised last; multi-category items appear in each', () => {
    const items = [item({ id: 'a', type_ids: ['t2'] }), item({ id: 'b', type_ids: ['t1', 't2'] }), item({ id: 'c' })];
    expect(groupByCategory(items, types, 'No category').map((g) => [g.title, g.items.map((i) => i.id)])).toEqual([
      ['Wine', ['b']], ['Beer', ['a', 'b']], ['No category', ['c']],
    ]);
  });
});
