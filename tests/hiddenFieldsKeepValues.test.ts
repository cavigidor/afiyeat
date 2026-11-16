import { describe, expect, it } from 'vitest';
import { customListItemPayload } from '@/lib/listItemSave';

// Lists V2 rule: hiding a field (or switching how price/rating is recorded) never deletes saved data.
// An update must leave every column the list currently doesn't show out of the payload entirely.
const base = { show_location: true, show_price: true, price_mode: 'dollar', show_rating: true, rating_mode: 'scale_10', show_notes: true } as const;
const location = { apple_place_id: null, address: '1 Main St', latitude: 1, longitude: 2 };
const fields = { statusId: 's1', typeIds: ['t1'], priceLevel: 2, priceManual: '12.5', rating: 8, ratingManual: '4.5', notes: ' Great ', photos: [] };

describe('customListItemPayload keeps hidden values', () => {
  it('writes every visible field', () => {
    const p = customListItemPayload(base, location, ' Rioja ', fields);
    expect(p).toMatchObject({ name: 'Rioja', address: '1 Main St', latitude: 1, longitude: 2, price_level: 2, rating: 8, notes: 'Great', status_id: 's1', type_ids: ['t1'] });
  });

  it('leaves out location, price, rating and notes when hidden, instead of clearing them', () => {
    const p = customListItemPayload({ ...base, show_location: false, show_price: false, show_rating: false, show_notes: false }, location, 'X', fields);
    for (const k of ['address', 'latitude', 'longitude', 'apple_place_id', 'price_level', 'price_manual', 'rating', 'rating_manual', 'notes']) {
      expect(p).not.toHaveProperty(k);
    }
    expect(p).toMatchObject({ name: 'X', status_id: 's1', type_ids: ['t1'] });
  });

  it('leaves the inactive price and rating style untouched', () => {
    const dollar = customListItemPayload(base, location, 'X', fields);
    expect(dollar).toHaveProperty('price_level', 2);
    expect(dollar).not.toHaveProperty('price_manual');
    expect(dollar).toHaveProperty('rating', 8);
    expect(dollar).not.toHaveProperty('rating_manual');
    const manual = customListItemPayload({ ...base, price_mode: 'manual', rating_mode: 'manual' }, location, 'X', fields);
    expect(manual).toHaveProperty('price_manual', 12.5);
    expect(manual).not.toHaveProperty('price_level');
    expect(manual).toHaveProperty('rating_manual', 4.5);
    expect(manual).not.toHaveProperty('rating');
  });

  it('a visible field cleared by the person is still written as empty', () => {
    const p = customListItemPayload(base, location, 'X', { ...fields, priceLevel: null, rating: null, notes: '' });
    expect(p).toMatchObject({ price_level: null, rating: null, notes: null });
  });
});
