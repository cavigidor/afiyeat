/**
 * Home / Explore / Search "Add to a list" (AddExplorePlaceDialog) is the
 * universal Add Item form with the place filled in. The destination list
 * decides the fields - the same ones as adding from inside that list - and
 * saving goes through lib/listItemSave.ts.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddExplorePlaceDialog } from '@/components/explore/AddExplorePlaceDialog';
import { AddItemDialog } from '@/components/lists/AddItemDialog';
import { AddCustomListItemDialog } from '@/components/lists/AddCustomListItemDialog';
import type { ExplorePlace } from '@/components/explore/ExplorePlaceCard';
import type { CustomList } from '@/components/lists/CreateListDialog';
import {
  fetchAddDestinations,
  fetchFolders,
  fetchListStatuses,
  fetchListTypes,
  readLastDestination,
  type AddDestination,
} from '@/lib/addDestinations';
import { saveCustomListItem, saveRestaurant, saveSharedListItem, type SaveResult } from '@/lib/listItemSave';

// Radix's Slider (the 10-point rating) measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('sonner', () => ({ toast: { dismiss: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/native', () => ({ isNative: () => false, capturePhoto: vi.fn() }));
vi.mock('@/lib/haptics', () => ({ hapticSuccess: vi.fn() }));
vi.mock('@/lib/contentFilter', () => ({ blockedByContentFilter: () => false }));
vi.mock('@/hooks/usePlaceAutocomplete', () => ({ usePlaceAutocomplete: () => ({
  searchQuery: '', setSearchQuery: vi.fn(), searchResults: [], searching: false,
  setShowResults: vi.fn(), noResults: false, dropdownVisible: false, selectPlace: vi.fn(), resetSearch: vi.fn(),
}) }));
vi.mock('@/lib/addDestinations', async (original) => ({
  ...await original<typeof import('@/lib/addDestinations')>(),
  fetchAddDestinations: vi.fn(), fetchListStatuses: vi.fn(), fetchListTypes: vi.fn(),
  fetchFolders: vi.fn(), readLastDestination: vi.fn(), rememberDestination: vi.fn(),
}));
vi.mock('@/lib/listItemSave', async (original) => ({
  ...await original<typeof import('@/lib/listItemSave')>(),
  saveCustomListItem: vi.fn(), saveRestaurant: vi.fn(), saveSharedListItem: vi.fn(),
}));

// -- Three differently configured lists, a shared list, and My Restaurants ---

const listBase: CustomList = {
  id: '', name: '', icon: '📋', color: '#000000', show_location: true, show_price: true, price_mode: 'dollar',
  show_rating: true, rating_mode: 'stars_5', show_notes: true, show_photos: true,
  status_todo_label: '', status_done_label: '',
};
const coffeeList: CustomList = { ...listBase, id: 'coffee', name: 'Coffee Shops', icon: '☕', show_photos: false };
const booksList: CustomList = {
  ...listBase, id: 'books', name: 'Books', icon: '📚', show_location: false, show_price: false, rating_mode: 'scale_10',
};
const wishList: CustomList = {
  ...listBase, id: 'wish', name: 'Gift ideas', icon: '🎁', show_rating: false, show_notes: false, show_photos: false,
  price_mode: 'manual',
};
const custom = (list: CustomList): AddDestination => ({ kind: 'custom', key: `custom:${list.id}`, label: list.name, icon: list.icon, list });
const shared: AddDestination = { kind: 'shared', key: 'shared:s1', label: 'Date nights', icon: '👥', listId: 's1', partnerName: 'Sam' };

const STATUSES: Record<string, { id: string; name: string; sort_order: number }[]> = {
  coffee: [{ id: 'try', name: 'Want to try', sort_order: 0 }, { id: 'been', name: 'Been', sort_order: 1 }],
  books: [{ id: 'want', name: 'Want to Read', sort_order: 0 }, { id: 'read', name: 'Read', sort_order: 1 }],
  wish: [{ id: 'idea', name: 'Idea', sort_order: 0 }],
};
const TYPES: Record<string, { id: string; name: string; color: string; sort_order: number }[]> = {
  coffee: [{ id: 'espresso', name: 'Espresso', color: '#333', sort_order: 0 }, { id: 'pour', name: 'Pour-over', color: '#666', sort_order: 1 }],
  books: [{ id: 'scifi', name: 'Sci-fi', color: '#00f', sort_order: 0 }],
  wish: [],
};
const FOLDERS = [{ id: 'f-cafe', name: 'Cafe', color: '#a50' }, { id: 'f-bar', name: 'Bar', color: '#05a' }];
const withList = (listId: string) => <T,>(rows: T[]) => rows.map((r) => ({ ...r, list_id: listId, user_id: 'owner' }));

const sawada: ExplorePlace = {
  place_id: 'A1', name: 'Sawada Coffee', address: '112 N Green St, Chicago, IL 60607, United States',
  latitude: 41.883, longitude: -87.649, category: 'Cafe', price_level: 1, avg_rating: 8.4, rating_count: 4,
  contributor_count: 4, apple_place_id: 'A1',
};
const legacy: ExplorePlace = { ...sawada, place_id: 'mapbox.poi.123', apple_place_id: null, name: 'Old Spot', category: 'Restaurant' };

const saved: SaveResult = { status: 'saved', id: 'new', photos: { uploaded: 0, failed: 0 } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchAddDestinations).mockResolvedValue({ custom: [custom(coffeeList), custom(booksList), custom(wishList)], shared: [shared] });
  vi.mocked(fetchListStatuses).mockImplementation(async (id) => withList(id)(STATUSES[id]) as never);
  vi.mocked(fetchListTypes).mockImplementation(async (id) => withList(id)(TYPES[id]) as never);
  vi.mocked(fetchFolders).mockResolvedValue(FOLDERS);
  vi.mocked(readLastDestination).mockReturnValue(null);
  vi.mocked(saveCustomListItem).mockResolvedValue(saved);
  vi.mocked(saveRestaurant).mockResolvedValue(saved);
  vi.mocked(saveSharedListItem).mockResolvedValue(saved);
});

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (ui: React.ReactNode) => (
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <QueryClientProvider client={client()}>{ui}</QueryClientProvider>
  </MemoryRouter>
);

function openFromHome(place: ExplorePlace | null = sawada) {
  const onOpenChange = vi.fn();
  render(wrap(<AddExplorePlaceDialog open onOpenChange={onOpenChange} place={place} />));
  return { onOpenChange };
}

const user = () => userEvent.setup();
async function chooseList(label: string) {
  const u = user();
  await u.click(screen.getByRole('combobox', { name: 'Add to' }));
  await u.click(await screen.findByRole('option', { name: new RegExp(label) }));
  await screen.findByRole('button', { name: `Add to ${label}` });
}
async function expandMore() {
  const more = screen.queryByRole('button', { name: /More details/ });
  if (more && more.getAttribute('aria-expanded') === 'false') fireEvent.click(more);
}

/**
 * Which fields a form shows, by label, normalised so the Home-origin form
 * and the in-list form can be compared ("Rating: Not rated/10" -> "Rating /10").
 */
function fieldsShown(root: HTMLElement = document.body): string[] {
  const labels = Array.from(root.querySelectorAll('label')).map((l) => (l.textContent ?? '').trim());
  const fields = new Set<string>();
  for (const text of labels) {
    if (/^Rating/.test(text)) fields.add(text.includes('/10') ? 'Rating /10' : text.includes('/5') || /Not rated$/.test(text) ? 'Rating /5' : 'Rating typed');
    else if (/^Price/.test(text)) fields.add(text.includes('$') || /Not set/.test(text) ? 'Price $' : 'Price typed');
    else if (/^Photos/.test(text)) fields.add('Photos');
    else if (/^(Name|Address|Status|Types|Notes|Search)$/.test(text)) fields.add(text);
  }
  return [...fields].sort();
}

const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

describe('Home-origin Add to a list', () => {
  it('opens the full form with the place filled in, not a one-tap save', async () => {
    openFromHome();
    expect(await screen.findByRole('heading', { name: 'Add to a list' })).toBeTruthy();
    await screen.findByRole('button', { name: 'Add to My Restaurants' });
    expect(value('Name')).toBe('Sawada Coffee');
    expect(value('Address')).toBe(sawada.address);
    // Nothing is saved until the user presses Add.
    expect(saveRestaurant).not.toHaveBeenCalled();
    expect(saveCustomListItem).not.toHaveBeenCalled();
    // The place is already found, so no place search.
    expect(screen.queryByLabelText('Search')).toBeNull();
  });

  it('My Restaurants: To Go / Been There, its types, rating once Been There, price/notes/photos', async () => {
    openFromHome();
    await screen.findByRole('button', { name: 'Add to My Restaurants' });
    expect(screen.getByRole('tab', { name: 'To Go' })).toBeTruthy();
    expect(await screen.findByText('Cafe')).toBeTruthy();
    expect(screen.queryByText(/^Rating/)).toBeNull(); // To Go isn't rated, as in My Restaurants
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Been There' }));
    await expandMore();
    expect(fieldsShown()).toEqual(['Address', 'Name', 'Notes', 'Photos', 'Price $', 'Rating /10', 'Status', 'Types']);
  });

  it('Coffee Shops list: its statuses, its types, 5-star rating, $ price, notes, no photos', async () => {
    openFromHome();
    await screen.findByRole('button', { name: 'Add to My Restaurants' });
    await chooseList('Coffee Shops');
    expect(await screen.findByRole('tab', { name: 'Want to try' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Been' })).toBeTruthy();
    expect(await screen.findByText('Espresso')).toBeTruthy();
    await expandMore();
    expect(fieldsShown()).toEqual(['Address', 'Name', 'Notes', 'Price $', 'Rating /5', 'Status', 'Types']);
    expect(value('Address')).toBe(sawada.address); // still filled in
  });

  it('Books list: no location or price, 10-point rating, notes and photos; name kept', async () => {
    openFromHome();
    await screen.findByRole('button', { name: 'Add to My Restaurants' });
    await chooseList('Books');
    await screen.findByRole('tab', { name: 'Want to Read' });
    await expandMore();
    expect(fieldsShown()).toEqual(['Name', 'Notes', 'Photos', 'Rating /10', 'Status', 'Types']);
    expect(screen.getByText("Books doesn't keep locations, so only the name is saved.")).toBeTruthy();
    expect(value('Name')).toBe('Sawada Coffee');
  });

  it('a list with rating, notes and photos turned off never shows them; typed price', async () => {
    openFromHome();
    await screen.findByRole('button', { name: 'Add to My Restaurants' });
    await chooseList('Gift ideas');
    await screen.findByRole('tab', { name: 'Idea' });
    await expandMore();
    expect(fieldsShown()).toEqual(['Address', 'Name', 'Price typed', 'Status']);
  });

  it('shared list: To Go / Been There, price and notes (what shared lists support)', async () => {
    openFromHome();
    await screen.findByRole('button', { name: 'Add to My Restaurants' });
    await chooseList('Date nights');
    await expandMore();
    expect(fieldsShown()).toEqual(['Address', 'Name', 'Notes', 'Price $', 'Status']);
    expect(screen.getByText('Shared with Sam')).toBeTruthy();
  });
});

describe('same fields as adding from inside the list', () => {
  async function inListFields(list: CustomList) {
    const { unmount } = render(wrap(
      <AddCustomListItemDialog
        open onOpenChange={() => {}} onSuccess={() => {}} list={list}
        statuses={withList(list.id)(STATUSES[list.id]) as never} types={withList(list.id)(TYPES[list.id]) as never}
      />,
    ));
    const fields = fieldsShown().filter((f) => f !== 'Search'); // Home already has the place
    unmount();
    return fields;
  }

  it.each([
    ['Coffee Shops', coffeeList, 'Want to try'],
    ['Books', booksList, 'Want to Read'],
    ['Gift ideas', wishList, 'Idea'],
  ] as const)('%s', async (label, list, firstStatus) => {
    const expected = await inListFields(list);
    openFromHome();
    await screen.findByRole('button', { name: 'Add to My Restaurants' });
    await chooseList(label);
    await screen.findByRole('tab', { name: firstStatus });
    await expandMore();
    expect(fieldsShown()).toEqual(expected);
  });
});

describe('saving', () => {
  it('saves to a custom list with what the user chose, by Apple ID', async () => {
    openFromHome();
    await screen.findByRole('button', { name: 'Add to My Restaurants' });
    await chooseList('Coffee Shops');
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Been' }));
    fireEvent.click(await screen.findByText('Pour-over'));
    fireEvent.click(screen.getByRole('button', { name: '4 stars' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Coffee Shops' }));
    await waitFor(() => expect(saveCustomListItem).toHaveBeenCalledTimes(1));
    const [uid, list, item, fields] = vi.mocked(saveCustomListItem).mock.calls[0];
    expect(uid).toBe('owner');
    expect(list.id).toBe('coffee');
    expect(item).toMatchObject({ name: 'Sawada Coffee', picked: { applePlaceId: 'A1' } });
    expect(fields).toMatchObject({ statusId: 'been', typeIds: ['pour'], rating: 4 });
  });

  it('saves to My Restaurants with status, types, rating and Apple category', async () => {
    openFromHome();
    await screen.findByRole('button', { name: 'Add to My Restaurants' });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Been There' }));
    fireEvent.click(await screen.findByText('Cafe'));
    fireEvent.click(screen.getByRole('button', { name: 'Add to My Restaurants' }));
    await waitFor(() => expect(saveRestaurant).toHaveBeenCalledTimes(1));
    const [, item, fields] = vi.mocked(saveRestaurant).mock.calls[0];
    expect(item).toMatchObject({ name: 'Sawada Coffee', picked: { applePlaceId: 'A1', category: 'Cafe' }, placeId: null });
    expect(fields).toMatchObject({ status: 'went_to', folderIds: ['f-cafe'], category: 'Cafe' });
  });

  it('keeps an older place id (never the synthetic "nm:" key) for a place without an Apple ID', async () => {
    openFromHome(legacy);
    await screen.findByRole('button', { name: 'Add to My Restaurants' });
    fireEvent.click(screen.getByRole('button', { name: 'Add to My Restaurants' }));
    await waitFor(() => expect(saveRestaurant).toHaveBeenCalledTimes(1));
    const [, item, fields] = vi.mocked(saveRestaurant).mock.calls[0];
    expect(item).toMatchObject({ name: 'Old Spot', picked: null, placeId: 'mapbox.poi.123', latitude: legacy.latitude });
    expect(fields.category).toBe('Restaurant');
  });

  it('does not store the synthetic name+address key as a place id', async () => {
    openFromHome({ ...legacy, place_id: 'nm:abc123' });
    await screen.findByRole('button', { name: 'Add to My Restaurants' });
    fireEvent.click(screen.getByRole('button', { name: 'Add to My Restaurants' }));
    await waitFor(() => expect(saveRestaurant).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveRestaurant).mock.calls[0][1].placeId).toBeNull();
  });

  it('saves to a shared list as a member', async () => {
    openFromHome();
    await screen.findByRole('button', { name: 'Add to My Restaurants' });
    await chooseList('Date nights');
    fireEvent.click(screen.getByRole('button', { name: 'Add to Date nights' }));
    await waitFor(() => expect(saveSharedListItem).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveSharedListItem).mock.calls[0].slice(0, 3)).toEqual([
      'owner', 's1', expect.objectContaining({ name: 'Sawada Coffee', picked: expect.objectContaining({ applePlaceId: 'A1' }) }),
    ]);
  });

  it('does not store a location on a list that has none', async () => {
    openFromHome();
    await screen.findByRole('button', { name: 'Add to My Restaurants' });
    await chooseList('Books');
    await screen.findByRole('tab', { name: 'Want to Read' });
    fireEvent.click(screen.getByRole('button', { name: 'Add to Books' }));
    await waitFor(() => expect(saveCustomListItem).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveCustomListItem).mock.calls[0][2]).toMatchObject({
      name: 'Sawada Coffee', address: null, latitude: null, longitude: null, picked: null, placeId: null,
    });
  });

  it('a failed save keeps everything entered, and retrying works', async () => {
    vi.mocked(saveCustomListItem).mockResolvedValueOnce({ status: 'error', error: new Error('network down') });
    const { onOpenChange } = openFromHome();
    await screen.findByRole('button', { name: 'Add to My Restaurants' });
    await chooseList('Coffee Shops');
    fireEvent.click(await screen.findByText('Espresso'));
    await expandMore();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Get the Mean Mug' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to Coffee Shops' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't add to Coffee Shops: network down/);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(value('Name')).toBe('Sawada Coffee');
    expect(value('Notes')).toBe('Get the Mean Mug');
    fireEvent.click(screen.getByRole('button', { name: 'Add to Coffee Shops' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(vi.mocked(saveCustomListItem).mock.calls[1][3]).toMatchObject({ typeIds: ['espresso'], notes: 'Get the Mean Mug' });
  });

  it('a duplicate keeps the draft and says so', async () => {
    vi.mocked(saveRestaurant).mockResolvedValueOnce({ status: 'duplicate' });
    const { onOpenChange } = openFromHome();
    await screen.findByRole('button', { name: 'Add to My Restaurants' });
    fireEvent.click(screen.getByRole('button', { name: 'Add to My Restaurants' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/already on My Restaurants/);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(value('Name')).toBe('Sawada Coffee');
  });
});

describe('switching lists', () => {
  it("drops the old list's statuses, types and an incompatible rating; keeps the place and notes", async () => {
    openFromHome();
    await screen.findByRole('button', { name: 'Add to My Restaurants' });
    await chooseList('Coffee Shops');
    fireEvent.click(await screen.findByText('Espresso'));
    fireEvent.click(screen.getByRole('button', { name: '4 stars' }));
    await expandMore();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Oat milk' } });

    await chooseList('Books'); // 10-point scale: the 5-star rating can't carry over
    await screen.findByRole('tab', { name: 'Want to Read' });
    expect(screen.getByText('Rating: Not rated/10')).toBeTruthy();
    expect(value('Notes')).toBe('Oat milk');

    await chooseList('Coffee Shops');
    await screen.findByRole('tab', { name: 'Want to try' });
    expect(value('Address')).toBe(sawada.address); // kept while hidden on Books
    fireEvent.click(screen.getByRole('button', { name: 'Add to Coffee Shops' }));
    await waitFor(() => expect(saveCustomListItem).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveCustomListItem).mock.calls[0][3]).toMatchObject({ typeIds: [], rating: null, notes: 'Oat milk', statusId: 'try' });
  });

  it('starts on the last list used, when it still exists', async () => {
    vi.mocked(readLastDestination).mockReturnValue('custom:coffee');
    openFromHome();
    expect(await screen.findByRole('button', { name: 'Add to Coffee Shops' })).toBeTruthy();
    expect(value('Name')).toBe('Sawada Coffee');
  });
});

describe('existing flows', () => {
  it('Add item from Lists still starts empty with place search', async () => {
    render(wrap(<AddItemDialog open onOpenChange={() => {}} />));
    expect(await screen.findByRole('heading', { name: 'Add item' })).toBeTruthy();
    await screen.findByRole('button', { name: 'Add to My Restaurants' });
    expect(value('Name')).toBe('');
    expect(screen.getByLabelText('Search')).toBeTruthy();
  });

  it('nothing opens without a place', () => {
    openFromHome(null);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Home, Explore and Search all use this dialog', () => {
    for (const file of ['src/pages/Home.tsx', 'src/pages/Explore.tsx', 'src/pages/Search.tsx']) {
      expect(readFileSync(file, 'utf8'), file).toMatch(/<AddExplorePlaceDialog\b/);
    }
  });
});
