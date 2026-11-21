import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddCustomListItemDialog, type CustomListItem } from '@/components/lists/AddCustomListItemDialog';
import { ItemSheet } from '@/components/lists/v2/ItemSheet';
import { readDetailsDraft, saveItemValues } from '@/lib/itemDetails';
import { toast } from 'sonner';
import { saveCustomListItem } from '@/lib/listItemSave';
import { fieldsForPreset } from '@/lib/presetFields';
import type { CustomList } from '@/components/lists/CreateListDialog';

// jsdom has no ResizeObserver; Radix's slider asks for one.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const update = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      update: (payload: unknown) => ({ eq: async () => { update(payload); return { error: null }; } }),
      delete: () => ({ in: async () => ({ error: null }) }),
    }),
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/usePlaceAutocomplete', () => ({ usePlaceAutocomplete: () => ({
  searchQuery: '', setSearchQuery: vi.fn(), searchResults: [], searching: false,
  setShowResults: vi.fn(), noResults: false, dropdownVisible: false, selectPlace: vi.fn(), resetSearch: vi.fn(),
}) }));
vi.mock('@/hooks/useSignedImageUrl', () => ({ useSignedImageUrls: () => ({ signedUrls: [] }), useSignedImageUrl: () => ({ signedUrl: null }) }));
vi.mock('@/lib/itemDetails', async (orig) => ({ ...await orig<typeof import('@/lib/itemDetails')>(), saveItemValues: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/listItemSave', async (orig) => ({ ...await orig<typeof import('@/lib/listItemSave')>(), saveCustomListItem: vi.fn() }));

const beans: CustomList = {
  id: 'beans', name: 'Coffee Beans', icon: '🫘', color: '#7A4E2D', show_location: false, show_price: true, price_mode: 'manual',
  show_rating: true, rating_mode: 'scale_10', show_notes: true, show_photos: false, status_todo_label: '', status_done_label: '',
} as CustomList;
const statuses = [{ id: 's1', name: 'Want to Try', sort_order: 0, list_id: 'beans', user_id: 'owner' }];
const item: CustomListItem = {
  id: 'halo', list_id: 'beans', name: 'Halo Beriti', address: null, latitude: null, longitude: null, price_level: null, price_manual: 18,
  rating: 9, rating_manual: null, notes: 'Bright and floral', status_id: 's1', type_id: null, type_ids: [], images: [],
};
// Roaster is hidden on this list; its value must survive an edit.
const fields = fieldsForPreset('coffee_beans').map((f) => (f.key === 'c_roaster' ? { ...f, hidden: true } : f));
const saved = { c_roaster: 'Tide Roasters', c_roast: 'Light', c_origin: 'Ethiopia' };

function edit(values: Record<string, unknown> | undefined = saved) {
  return render(<AddCustomListItemDialog open onOpenChange={vi.fn()} list={beans} statuses={statuses as never} onSuccess={vi.fn()}
    editItem={item} fields={fields} itemValues={values as never} />);
}

beforeEach(() => {
  vi.mocked(saveItemValues).mockReset();
  vi.mocked(saveItemValues).mockResolvedValue({ ok: true });
  update.mockClear(); vi.mocked(saveCustomListItem).mockReset(); localStorage.clear();
});

describe('item details in the editor', () => {
  it('is compact: main fields first, the rest under More details, which opens when one of them has a value', async () => {
    edit({ c_roast: 'Light' });
    expect(screen.getByText('Coffee name')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getAllByRole('radio')).toHaveLength(6); // exactly six roasts, one control
    expect(screen.queryByText('Origin')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /More details/ }));
    expect(screen.getByText('Origin')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Best for' })).toBeTruthy();
  });

  it('saves the edit with every other value kept, hidden ones included, and leaves Notes alone', async () => {
    edit();
    expect(screen.getByText('Origin')).toBeTruthy(); // opened: a "more" field has a value
    fireEvent.click(screen.getByRole('radio', { name: 'Medium-Dark' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Espresso' }));
    const add = screen.getByRole('textbox', { name: 'Add to Taste profile' });
    fireEvent.change(add, { target: { value: 'jasmine' } });
    fireEvent.keyDown(add, { key: 'Enter' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chocolate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(saveItemValues).toHaveBeenCalledTimes(1));
    expect(saveItemValues).toHaveBeenCalledWith('owner', 'beans', 'halo', {
      c_roaster: 'Tide Roasters', c_roast: 'Medium-Dark', c_origin: 'Ethiopia', c_best_for: ['Espresso'], c_taste_profile: ['jasmine', 'Chocolate'],
    }, true);
    expect(update.mock.calls[0][0]).toMatchObject({ name: 'Halo Beriti', notes: 'Bright and floral' });
    expect(JSON.stringify(update.mock.calls[0][0])).not.toContain('Medium-Dark');
  });

  it('every field is optional: adding an item with none filled writes no details at all', async () => {
    vi.mocked(saveCustomListItem).mockResolvedValue({ status: 'saved', id: 'new', photos: { uploaded: 0, failed: 0 } });
    render(<AddCustomListItemDialog open onOpenChange={vi.fn()} list={beans} statuses={statuses as never} onSuccess={vi.fn()} fields={fields} />);
    fireEvent.change(screen.getByLabelText('Coffee name'), { target: { value: 'Gift bag' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Item' }));
    await waitFor(() => expect(saveItemValues).toHaveBeenCalledTimes(1));
    expect(saveItemValues).toHaveBeenCalledWith('owner', 'beans', 'new', {}, false); // nothing to save -> no row
  });

  it('shows a mistake next to the field instead of saving', async () => {
    // A number field out of range on a Wines list.
    const wines = { ...beans, id: 'wines', icon: '🍷', name: 'Wines' } as CustomList;
    render(<AddCustomListItemDialog open onOpenChange={vi.fn()} list={wines} statuses={statuses as never} onSuccess={vi.fn()}
      editItem={{ ...item, id: 'rioja', list_id: 'wines' }} fields={fieldsForPreset('wines')} itemValues={{}} />);
    const dialog = screen.getAllByRole('dialog').at(-1)!;
    fireEvent.change(within(dialog).getByLabelText('Vintage'), { target: { value: '19' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    expect(await within(dialog).findByText('Between 1800 and 2100')).toBeTruthy();
    expect(saveItemValues).not.toHaveBeenCalled();
  });

  it('without item details (production today) the editor is exactly as before', () => {
    render(<AddCustomListItemDialog open onOpenChange={vi.fn()} list={beans} statuses={statuses as never} onSuccess={vi.fn()} editItem={item} />);
    expect(screen.queryByTestId('details-fields')).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Light' })).toBeNull();
  });
});

describe('item details on the item page', () => {
  it('shows only filled, shown fields', () => {
    render(<ItemSheet item={item} list={beans} types={[]} statuses={statuses as never} onClose={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()}
      onMove={vi.fn()} fields={fields} values={{ c_roaster: 'Tide Roasters', c_roast: 'Light', c_best_for: ['Espresso', 'Cold Brew'] }} />);
    const details = document.querySelector('dl[aria-label="Details"]') as HTMLElement;
    expect(within(details).getByText('Light')).toBeTruthy();
    expect(within(details).getByText('Espresso, Cold Brew')).toBeTruthy();
    expect(within(details).queryByText('Tide Roasters')).toBeNull(); // Roaster is hidden on this list
    expect(within(details).queryByText('Origin')).toBeNull(); // empty
  });
});

describe('when the details fail to save after the item saved', () => {
  const fail = { ok: false as const, error: { message: 'network' } };

  it('editing: says exactly what saved, keeps everything typed, and Try again saves only the details', async () => {
    vi.mocked(saveItemValues).mockResolvedValueOnce(fail).mockResolvedValueOnce({ ok: true });
    const onOpenChange = vi.fn(), onSuccess = vi.fn();
    render(<AddCustomListItemDialog open onOpenChange={onOpenChange} list={beans} statuses={statuses as never} onSuccess={onSuccess}
      editItem={item} fields={fields} itemValues={saved as never} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Medium-Dark' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('Halo Beriti is saved. Its details aren’t saved yet.')).toBeTruthy();
    expect(toast.warning).toHaveBeenCalledWith('Halo Beriti is saved, but its details didn’t save yet.');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalledTimes(1); // the list refreshes: the item itself did save
    expect(screen.getByRole('radio', { name: 'Medium-Dark' }).getAttribute('aria-checked')).toBe('true');
    expect(readDetailsDraft('halo')).toMatchObject({ c_roast: 'Medium-Dark', c_roaster: 'Tide Roasters' });
    fireEvent.click(screen.getByRole('button', { name: 'Try saving details again' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(saveItemValues).toHaveBeenCalledTimes(2);
    expect(vi.mocked(saveItemValues).mock.calls[1]).toEqual(vi.mocked(saveItemValues).mock.calls[0]);
    expect(update).toHaveBeenCalledTimes(1); // the item was written once
    expect(readDetailsDraft('halo')).toBeNull();
  });

  it('adding: the retry never creates the item a second time', async () => {
    vi.mocked(saveCustomListItem).mockResolvedValue({ status: 'saved', id: 'new-1', photos: { uploaded: 0, failed: 0 } });
    vi.mocked(saveItemValues).mockResolvedValueOnce(fail).mockResolvedValueOnce(fail).mockResolvedValueOnce({ ok: true });
    render(<AddCustomListItemDialog open onOpenChange={vi.fn()} list={beans} statuses={statuses as never} onSuccess={vi.fn()} fields={fields} />);
    fireEvent.change(screen.getByLabelText('Coffee name'), { target: { value: 'La Esperanza' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Item' }));
    await screen.findByRole('button', { name: 'Try saving details again' });
    fireEvent.click(screen.getByRole('button', { name: 'Try saving details again' }));
    await waitFor(() => expect(saveItemValues).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'Try saving details again' })).toBeTruthy(); // still failing: still offered
    fireEvent.click(screen.getByRole('button', { name: 'Try saving details again' }));
    await waitFor(() => expect(saveItemValues).toHaveBeenCalledTimes(3));
    expect(saveCustomListItem).toHaveBeenCalledTimes(1);
    for (const call of vi.mocked(saveItemValues).mock.calls) expect(call.slice(2)).toEqual(['new-1', { c_roast: 'Light' }, false]);
  });

  it('closing keeps the typed details on this device, and the next Edit restores them', async () => {
    vi.mocked(saveItemValues).mockResolvedValueOnce(fail);
    const { unmount } = render(<AddCustomListItemDialog open onOpenChange={vi.fn()} list={beans} statuses={statuses as never} onSuccess={vi.fn()}
      editItem={item} fields={fields} itemValues={saved as never} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Extra Dark' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await screen.findByRole('button', { name: 'Close and keep for later' });
    unmount();
    edit(); // reopened later, with the old saved values from the server
    expect(screen.getByText('Restored details that didn’t save last time. Save to keep them.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Extra Dark' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(saveItemValues).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveItemValues).mock.calls[1][3]).toMatchObject({ c_roast: 'Extra Dark', c_roaster: 'Tide Roasters' });
    await waitFor(() => expect(readDetailsDraft('halo')).toBeNull());
  });
});

describe('Edit Item and the iPhone keyboard', () => {
  it('opening the editor focuses the dialog, not a text field; tapping a field still focuses it', async () => {
    edit();
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('dialog'));
    expect(['INPUT', 'TEXTAREA']).not.toContain(document.activeElement?.tagName);
    const nameField = screen.getByLabelText('Coffee name');
    await userEvent.click(nameField);
    expect(document.activeElement).toBe(nameField);
  });
});

