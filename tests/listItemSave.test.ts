import { beforeEach, describe, expect, it, vi } from 'vitest';
import { photoUploadWarning, saveCustomListItem, saveRestaurant } from '@/lib/listItemSave';
import type { CustomList } from '@/components/lists/CreateListDialog';

const db = vi.hoisted(() => ({ from: vi.fn(), itemInsert: vi.fn(), imageInsert: vi.fn(), upload: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: db.from, storage: { from: () => ({ upload: db.upload }) },
} }));
vi.mock('@/lib/duplicateRestaurant', () => ({
  isDuplicateRestaurant: async () => false, isDuplicateCustomListItem: async () => false,
  isDuplicateSharedItem: async () => false,
}));

const list: CustomList = { id: 'books', name: 'Books', icon: '📚', color: '#000', show_location: false,
  show_price: false, price_mode: 'dollar', show_rating: false, rating_mode: 'stars_5',
  show_notes: true, show_photos: true, status_todo_label: '', status_done_label: '' };
const files = () => [new File(['one'], 'one.jpg'), new File(['two'], 'two.jpg')];
const destinations = [
  { name: 'restaurants', table: 'restaurant_images', ownerKey: 'restaurant_id', save: (photos: File[]) =>
    saveRestaurant('owner', { name: 'Cafe' }, { status: 'to_go', folderIds: [], photos }) },
  { name: 'custom lists', table: 'custom_list_item_images', ownerKey: 'item_id', save: (photos: File[]) =>
    saveCustomListItem('owner', list, { name: 'Book' }, { statusId: 'want', typeIds: [], photos }) },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  db.upload.mockResolvedValue({ error: null });
  db.imageInsert.mockResolvedValue({ error: null });
  db.itemInsert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: 'saved-item' }, error: null }) }) });
  db.from.mockImplementation((table: string) => ({ insert: table.endsWith('_images') ? db.imageInsert : db.itemInsert }));
});

describe.each(destinations)('$name attachment outcomes', ({ table, ownerKey, save }) => {
  it('reports full success only after storage and both attachment records succeed', async () => {
    const result = await save(files());
    expect(result).toEqual({ status: 'saved', id: 'saved-item', photos: { uploaded: 2, failed: 0 } });
    expect(db.itemInsert).toHaveBeenCalledTimes(1);
    expect(db.upload).toHaveBeenCalledTimes(2);
    expect(db.from).toHaveBeenCalledWith(table);
    expect(db.imageInsert).toHaveBeenCalledWith(expect.objectContaining({ [ownerKey]: 'saved-item', user_id: 'owner' }));
    if (result.status === 'saved') expect(photoUploadWarning(result.photos)).toBeNull();
  });

  it('preserves the saved item and other attachment when one storage upload fails', async () => {
    db.upload.mockResolvedValueOnce({ error: { message: 'storage offline' } });
    const result = await save(files());
    expect(result).toEqual({ status: 'saved', id: 'saved-item', photos: { uploaded: 1, failed: 1 } });
    expect(db.imageInsert).toHaveBeenCalledTimes(1);
    expect(db.itemInsert).toHaveBeenCalledTimes(1);
  });

  it('counts a failed attachment record as a failure even if its blob uploaded', async () => {
    db.imageInsert.mockResolvedValueOnce({ error: { message: 'attachment denied' } });
    expect(await save(files())).toEqual({ status: 'saved', id: 'saved-item', photos: { uploaded: 1, failed: 1 } });
    expect(db.upload).toHaveBeenCalledTimes(2);
    expect(db.itemInsert).toHaveBeenCalledTimes(1);
  });

  it('continues after a rejected storage request without reporting item-save failure', async () => {
    db.upload.mockRejectedValueOnce(new Error('network disconnected'));
    expect(await save(files())).toEqual({ status: 'saved', id: 'saved-item', photos: { uploaded: 1, failed: 1 } });
    expect(db.upload).toHaveBeenCalledTimes(2);
  });

  it('continues after a rejected attachment-record request', async () => {
    db.imageInsert.mockRejectedValueOnce(new Error('network disconnected'));
    expect(await save(files())).toEqual({ status: 'saved', id: 'saved-item', photos: { uploaded: 1, failed: 1 } });
  });

  it('reports all failed photos accurately while retaining the item ID', async () => {
    db.upload.mockResolvedValue({ error: { message: 'offline' } });
    const result = await save(files());
    expect(result).toEqual({ status: 'saved', id: 'saved-item', photos: { uploaded: 0, failed: 2 } });
    if (result.status === 'saved') expect(photoUploadWarning(result.photos)).toContain("2 photos couldn't be attached");
  });

  it('does not upload attachments when the item insert itself fails', async () => {
    db.itemInsert.mockReturnValue({ select: () => ({ single: async () => ({ data: null, error: new Error('item denied') }) }) });
    expect(await save(files())).toMatchObject({ status: 'error' });
    expect(db.upload).not.toHaveBeenCalled();
  });
});
