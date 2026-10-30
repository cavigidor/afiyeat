import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { AddItemDialog } from '@/components/lists/AddItemDialog';
import { fetchAddDestinations, fetchListStatuses, readLastDestination, type AddDestination } from '@/lib/addDestinations';
import { saveCustomListItem, type SaveResult } from '@/lib/listItemSave';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
vi.mock('sonner', () => ({ toast: { dismiss: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/native', () => ({ isNative: () => false, capturePhoto: vi.fn() }));
vi.mock('@/lib/haptics', () => ({ hapticSuccess: vi.fn() }));
vi.mock('@/hooks/usePlaceAutocomplete', () => ({ usePlaceAutocomplete: () => ({
  searchQuery: '', setSearchQuery: vi.fn(), searchResults: [], searching: false,
  setShowResults: vi.fn(), noResults: false, dropdownVisible: false, selectPlace: vi.fn(), resetSearch: vi.fn(),
}) }));
vi.mock('@/lib/addDestinations', async (original) => ({
  ...await original<typeof import('@/lib/addDestinations')>(),
  fetchAddDestinations: vi.fn(), fetchListStatuses: vi.fn(), fetchListTypes: async () => [],
  fetchFolders: async () => [], readLastDestination: vi.fn(), rememberDestination: vi.fn(),
}));
vi.mock('@/lib/listItemSave', async (original) => ({
  ...await original<typeof import('@/lib/listItemSave')>(), saveCustomListItem: vi.fn(),
}));

const books: AddDestination = {
  kind: 'custom', key: 'custom:books', label: 'Books', icon: '📚',
  list: { id: 'books', name: 'Books', icon: '📚', color: '#000000', show_location: false,
    show_price: false, price_mode: 'dollar', show_rating: false, rating_mode: 'stars_5',
    show_notes: true, show_photos: true, status_todo_label: '', status_done_label: '' },
};
const statuses = [
  { id: 'read', name: 'Read', sort_order: 1, list_id: 'books', user_id: 'owner' },
  { id: 'want', name: 'Want to Read', sort_order: 0, list_id: 'books', user_id: 'owner' },
];
const saved: SaveResult = { status: 'saved', id: 'new-item', photos: { uploaded: 0, failed: 0 } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function showDialog(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const onOpenChange = vi.fn();
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><QueryClientProvider client={client}>
    <AddItemDialog open onOpenChange={onOpenChange} />
  </QueryClientProvider></MemoryRouter>);
  return { onOpenChange, client };
}

const addButton = () => screen.getByRole('button', { name: 'Add to Books' }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchAddDestinations).mockResolvedValue({ custom: [books], shared: [] });
  vi.mocked(readLastDestination).mockReturnValue('custom:books');
  vi.mocked(fetchListStatuses).mockResolvedValue(statuses);
  vi.mocked(saveCustomListItem).mockResolvedValue(saved);
});

describe('Add Item status retrieval', () => {
  it('blocks a fast save until statuses arrive, then uses the first ordered status', async () => {
    const pending = deferred<typeof statuses>();
    vi.mocked(fetchListStatuses).mockReturnValue(pending.promise);
    showDialog();
    await screen.findByText('Loading list statuses…');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dune' } });
    expect(addButton().disabled).toBe(true);
    fireEvent.click(addButton());
    expect(saveCustomListItem).not.toHaveBeenCalled();
    await act(async () => pending.resolve(statuses));
    await waitFor(() => expect(addButton().disabled).toBe(false));
    fireEvent.click(addButton());
    await waitFor(() => expect(saveCustomListItem).toHaveBeenCalledWith('owner', books.list,
      expect.objectContaining({ name: 'Dune' }), expect.objectContaining({ statusId: 'want' })));
  });

  it('keeps the draft and blocks saving after failure, then recovers through Retry', async () => {
    vi.mocked(fetchListStatuses).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(statuses);
    showDialog();
    await screen.findByText(/Couldn't load this list's statuses/);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dune' } });
    expect(addButton().disabled).toBe(true);
    fireEvent.click(addButton());
    expect(saveCustomListItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Try loading statuses again' }));
    await waitFor(() => expect(addButton().disabled).toBe(false));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Dune');
    fireEvent.click(addButton());
    await waitFor(() => expect(saveCustomListItem).toHaveBeenCalledWith('owner', books.list,
      expect.objectContaining({ name: 'Dune' }), expect.objectContaining({ statusId: 'want' })));
  });

  it('blocks cached statuses when a background refresh fails', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['add-item-statuses', 'books'], statuses);
    vi.mocked(fetchListStatuses).mockRejectedValue(new Error('offline'));
    showDialog(client);
    await screen.findByText(/Couldn't load this list's statuses/);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dune' } });
    expect(addButton().disabled).toBe(true);
    expect(saveCustomListItem).not.toHaveBeenCalled();
  });

  it('blocks an empty status configuration instead of creating an invisible item', async () => {
    vi.mocked(fetchListStatuses).mockResolvedValue([]);
    showDialog();
    await screen.findByText('This list has no statuses. Open the list and add a status before adding items.');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dune' } });
    expect(addButton().disabled).toBe(true);
    fireEvent.click(addButton());
    expect(saveCustomListItem).not.toHaveBeenCalled();
  });

  it('does not carry the previous list status into a newly selected list while it loads', async () => {
    const movies: AddDestination = { ...books, key: 'custom:movies', label: 'Movies',
      list: { ...books.list, id: 'movies', name: 'Movies' } };
    const pending = deferred<typeof statuses>();
    vi.mocked(fetchAddDestinations).mockResolvedValue({ custom: [books, movies], shared: [] });
    vi.mocked(fetchListStatuses).mockImplementation((id) => id === 'books' ? Promise.resolve(statuses) : pending.promise);
    showDialog();
    await screen.findByRole('tab', { name: 'Want to Read' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dune' } });
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /Movies/ }));
    await screen.findByText('Loading list statuses…');
    const button = screen.getByRole('button', { name: 'Add to Movies' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await act(async () => pending.resolve([{ ...statuses[0], id: 'watch', list_id: 'movies', name: 'Want to Watch' }]));
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(saveCustomListItem).toHaveBeenCalledWith('owner', movies.list,
      expect.objectContaining({ name: 'Dune' }), expect.objectContaining({ statusId: 'watch' })));
  });
});

describe('Add Item save feedback', () => {
  it('shows success when all attachments succeed', async () => {
    vi.mocked(saveCustomListItem).mockResolvedValue({ ...saved, photos: { uploaded: 2, failed: 0 } });
    const { onOpenChange } = showDialog();
    await screen.findByRole('tab', { name: 'Want to Read' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dune' } });
    fireEvent.click(addButton());
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.warning).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('warns about partial attachments without offering to insert the saved item again', async () => {
    vi.mocked(saveCustomListItem).mockResolvedValue({ ...saved, photos: { uploaded: 1, failed: 1 } });
    const { onOpenChange } = showDialog();
    await screen.findByRole('tab', { name: 'Want to Read' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dune' } });
    fireEvent.click(addButton());
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("1 photo couldn't be attached"), expect.anything()));
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(saveCustomListItem).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('prevents dismissal while saving so a completion cannot close a later draft', async () => {
    const pending = deferred<SaveResult>();
    vi.mocked(saveCustomListItem).mockReturnValue(pending.promise);
    const { onOpenChange } = showDialog();
    await screen.findByRole('tab', { name: 'Want to Read' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dune' } });
    fireEvent.click(addButton());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => pending.resolve(saved));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
