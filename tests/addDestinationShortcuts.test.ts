import { beforeEach, describe, expect, it } from 'vitest';
import {
  RESTAURANTS_DESTINATION,
  readLastDestination,
  readRecentDestinations,
  rememberDestination,
  shortcutDestinations,
  type AddDestination,
} from '@/lib/addDestinations';

const custom = (id: string, name: string): AddDestination =>
  ({ kind: 'custom', key: `custom:${id}`, label: name, icon: '📚', list: { id, name } }) as unknown as AddDestination;

const books = custom('books', 'Books');
const drinks = custom('drinks', 'Drinks');
const all = [RESTAURANTS_DESTINATION, books, drinks];

describe('recent Add Item destinations', () => {
  beforeEach(() => localStorage.clear());

  it('remembers newest first, without duplicates, and keeps the old last-destination key', () => {
    rememberDestination('custom:books');
    rememberDestination('restaurants');
    rememberDestination('custom:books');
    expect(readRecentDestinations()).toEqual(['custom:books', 'restaurants']);
    expect(readLastDestination()).toBe('custom:books');
  });

  it('picks up the last destination saved by an older version', () => {
    localStorage.setItem('afiyeat:add-item:last-destination', 'custom:drinks');
    expect(readRecentDestinations()).toEqual(['custom:drinks']);
  });

  it('survives unreadable stored data', () => {
    localStorage.setItem('afiyeat:add-item:recent-destinations', '{not json');
    expect(readRecentDestinations()).toEqual([]);
  });

  it('offers recent lists that still exist, then My Restaurants; nothing when only one choice', () => {
    expect(shortcutDestinations(all, ['custom:drinks', 'custom:gone', 'custom:books']).map((d) => d.key)).toEqual([
      'custom:drinks',
      'custom:books',
      'restaurants',
    ]);
    expect(shortcutDestinations(all, [])).toEqual([]);
    expect(shortcutDestinations(all, ['restaurants'])).toEqual([]);
  });
});
