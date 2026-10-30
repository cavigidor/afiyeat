/**
 * CP2 client behaviour: how community lists are shown, opened and searched,
 * and how a list's visibility is chosen. What the server returns - and
 * withholds - is covered by listVisibility.db.test.ts; these tests check
 * the app never adds identity back, never auto-publishes, and keeps the
 * existing Lists / Home / Explore entry points working.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Mocks: Supabase, auth, share identity, toasts, navbar
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  user: { id: 'me' } as { id: string } | null,
  isPrivate: false,
  toastError: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: h.rpc, from: h.from },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: h.user, loading: false }),
}));
vi.mock('@/hooks/useMyShareIdentity', () => ({
  useMyShareIdentity: () => ({ isPrivate: h.isPrivate }),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: h.toastError, success: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock('@/components/layout/Navbar', () => ({ Navbar: () => null }));

import {
  communityListKey,
  communityListPath,
  fetchCommunityLists,
  fetchDiscoverableList,
  uniqueLists,
  COMMUNITY_PAGE_SIZE,
} from '@/lib/communityLists';
import { visibilityOptions, visibilityChip } from '@/lib/listVisibility';
import { resolveActiveTab } from '@/lib/navigation';
import { ExploreListCard, type ExploreList } from '@/components/explore/ExploreListCard';
import { ListTile } from '@/components/discovery/DiscoveryTiles';
import { CommunityListsBrowser } from '@/components/discovery/CommunityListsBrowser';
import { DiscoverableListView } from '@/components/lists/DiscoverableListView';
import { ListVisibilityControl } from '@/components/lists/ListVisibilityControl';
import { CreateListDialog, type CustomList } from '@/components/lists/CreateListDialog';
import { ListResults } from '@/components/search/ListResults';
import { CommunityListsSection } from '@/components/home/CommunityListsSection';
import DiscoverableListPage from '@/pages/DiscoverableList';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TOKEN = '2b1f4a1e-9c7d-4b7a-8f3e-0d6c1a2b3c4d';

const identified = (over: Partial<ExploreList> = {}): ExploreList => ({
  list_id: 'list-alice',
  list_name: 'Natural wines',
  list_icon: '🍷',
  item_count: 4,
  user_id: 'alice',
  username: 'alice',
  display_name: 'Alice',
  avatar_emoji: '🦊',
  avatar_color: '#f00',
  is_anonymous: false,
  discovery_token: null,
  ...over,
});

const anonymous = (over: Partial<ExploreList> = {}): ExploreList => ({
  list_id: null,
  list_name: 'Books to reread',
  list_icon: '📚',
  item_count: 5,
  user_id: null,
  username: null,
  display_name: null,
  avatar_emoji: null,
  avatar_color: null,
  is_anonymous: true,
  discovery_token: TOKEN,
  ...over,
});

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function renderWith(ui: ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        {ui}
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** rpc mock that answers get_explore_lists with pages, by offset. */
function serveExploreLists(byOffset: Record<number, ExploreList[]>) {
  h.rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'get_explore_lists') return { data: byOffset[(args.p_offset as number) ?? 0] ?? [], error: null };
    return { data: null, error: null };
  });
}

beforeEach(() => {
  h.rpc.mockReset();
  h.from.mockReset();
  h.toastError.mockReset();
  h.user = { id: 'me' };
  h.isPrivate = false;
});

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

describe('community list helpers', () => {
  it('opens anonymous lists by token and identified lists by owner + id', () => {
    expect(communityListPath(anonymous())).toBe(`/lists/discover/${TOKEN}`);
    expect(communityListPath(identified())).toBe('/u/alice/lists/list-alice');
    // A malformed row opens nothing rather than a broken link.
    expect(communityListPath(anonymous({ discovery_token: null }))).toBeNull();
    expect(communityListPath(identified({ user_id: null }))).toBeNull();
  });

  it('keys cards uniquely and drops duplicates across pages', () => {
    expect(communityListKey(identified())).toBe('list-alice');
    expect(communityListKey(anonymous())).toBe(`anon:${TOKEN}`);
    const deduped = uniqueLists([identified(), anonymous(), identified(), anonymous(), anonymous({ discovery_token: 'x' })]);
    expect(deduped.map(communityListKey)).toEqual(['list-alice', `anon:${TOKEN}`, 'anon:x']);
  });

  it('passes mode, trimmed query and page to the server and reports the next page', async () => {
    h.rpc.mockResolvedValue({ data: Array.from({ length: COMMUNITY_PAGE_SIZE }, (_, i) => identified({ list_id: `l${i}` })), error: null });
    const page = await fetchCommunityLists({ mode: 'friends', query: '  wine ', offset: 30 });
    expect(h.rpc).toHaveBeenCalledWith('get_explore_lists', { p_mode: 'friends', p_query: 'wine', p_limit: 30, p_offset: 30 });
    expect(page.nextOffset).toBe(60);

    h.rpc.mockResolvedValue({ data: [identified()], error: null });
    expect((await fetchCommunityLists({ mode: 'all', query: '   ' })).nextOffset).toBeNull();
    expect(h.rpc).toHaveBeenLastCalledWith('get_explore_lists', { p_mode: 'all', p_query: null, p_limit: 30, p_offset: 0 });
  });

  it('treats a revoked or malformed anonymous link as not found', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    expect(await fetchDiscoverableList(TOKEN)).toBeNull();
    h.rpc.mockResolvedValue({ data: null, error: { message: 'invalid input syntax for type uuid', code: '22P02' } });
    expect(await fetchDiscoverableList('not-a-uuid')).toBeNull();
    h.rpc.mockResolvedValue({ data: null, error: { message: 'boom', code: '500' } });
    await expect(fetchDiscoverableList(TOKEN)).rejects.toBeTruthy();
  });
});

describe('visibility options', () => {
  it('public accounts choose between everyone and only me', () => {
    const opts = visibilityOptions(false);
    expect(opts.map((o) => o.label)).toEqual(['Visible to everyone', 'Only me']);
  });

  it('private accounts can also opt in to anonymous discovery', () => {
    const opts = visibilityOptions(true);
    expect(opts.map((o) => o.label)).toEqual(['Followers only', 'Discoverable anonymously', 'Only me']);
  });

  it('an already-anonymous list always shows its real setting, even after the account goes public', () => {
    expect(visibilityOptions(false, 'anonymous').map((o) => o.value)).toContain('anonymous');
    expect(visibilityChip('anonymous', false).label).toBe('Discoverable anonymously');
    expect(visibilityChip(undefined, false).label).toBe('Visible to everyone');
    expect(visibilityChip('private', true).label).toBe('Only me');
  });
});

describe('navigation', () => {
  it('an anonymous list keeps the tab it was opened from, and falls back to Explore', async () => {
    vi.resetModules();
    const fresh = await import('@/lib/navigation');
    expect(fresh.resolveActiveTab(`/lists/discover/${TOKEN}`)).toBe('/explore');
    expect(resolveActiveTab('/my-lists')).toBe('/my-lists');
    expect(resolveActiveTab(`/lists/discover/${TOKEN}`)).toBe('/my-lists');
  });
});

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

describe('ExploreListCard', () => {
  it('shows an anonymous list with no name, avatar or profile link, and opens it by token', () => {
    renderWith(<ExploreListCard list={anonymous()} />);
    const card = screen.getByRole('link', { name: /Books to reread, anonymous list/ });
    expect(within(card).getByText('Anonymous')).toBeTruthy();
    expect(within(card).queryByRole('button')).toBeNull(); // no profile button
    expect(card.textContent).not.toMatch(/Afiyeat member|alice|priya/i);
    fireEvent.click(card);
    expect(screen.getByTestId('location').textContent).toBe(`/lists/discover/${TOKEN}`);
  });

  it('shows an identified list with its owner, opening the list or the profile', () => {
    renderWith(<ExploreListCard list={identified()} />);
    const card = screen.getByRole('link', { name: /Natural wines, by Alice/ });
    expect(within(card).queryByText('Anonymous')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: /Alice/ }));
    expect(screen.getByTestId('location').textContent).toBe('/u/alice');
    fireEvent.click(card);
    expect(screen.getByTestId('location').textContent).toBe('/u/alice/lists/list-alice');
  });

  it('Home tiles label anonymous lists without any owner', () => {
    renderWith(<ListTile list={anonymous()} />);
    expect(screen.getByText('Shared anonymously')).toBeTruthy();
    expect(screen.queryByText(/Afiyeat member/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Explore -> Lists / Lists -> Discover
// ---------------------------------------------------------------------------

describe('CommunityListsBrowser', () => {
  it('lists identified and anonymous lists once each, leaving out your own', async () => {
    serveExploreLists({
      0: [identified(), anonymous(), identified({ list_id: 'mine', user_id: 'me', list_name: 'My own list' }), identified()],
    });
    renderWith(<CommunityListsBrowser excludeOwn />);
    expect(await screen.findByText('Natural wines')).toBeTruthy();
    expect(screen.getByText('Books to reread')).toBeTruthy();
    expect(screen.queryByText('My own list')).toBeNull();
    expect(screen.getAllByText('Natural wines')).toHaveLength(1);
  });

  it('searches on the server, debounced', async () => {
    serveExploreLists({ 0: [] });
    renderWith(<CommunityListsBrowser />);
    expect(await screen.findByText('Nothing to discover yet')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search community lists'), { target: { value: 'riesling' } });
    expect(await screen.findByText('No lists match', {}, { timeout: 2000 })).toBeTruthy();
    expect(h.rpc).toHaveBeenLastCalledWith('get_explore_lists', expect.objectContaining({ p_query: 'riesling' }));
  });

  it('pages with "Show more lists" and stops when the server runs out', async () => {
    const first = Array.from({ length: COMMUNITY_PAGE_SIZE }, (_, i) => identified({ list_id: `l${i}`, list_name: `List ${i}` }));
    serveExploreLists({ 0: first, 30: [anonymous({ list_name: 'Last one' })] });
    renderWith(<CommunityListsBrowser />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show more lists' }));
    expect(await screen.findByText('Last one')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more lists' })).toBeNull();
  });

  it('shows an error with a retry', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    renderWith(<CommunityListsBrowser />);
    expect(await screen.findByText("Couldn't load lists.")).toBeTruthy();
  });

  it('asks the server for friends only when the Friends tab is chosen', async () => {
    serveExploreLists({ 0: [] });
    renderWith(<CommunityListsBrowser />);
    await screen.findByText('Nothing to discover yet');
    const friends = screen.getByRole('tab', { name: 'Friends' });
    fireEvent.mouseDown(friends);
    fireEvent.click(friends);
    await waitFor(() => expect(h.rpc).toHaveBeenLastCalledWith('get_explore_lists', expect.objectContaining({ p_mode: 'friends' })));
  });
});

describe('Search and Home entry points', () => {
  it('search results include anonymous matches and link to the full search', async () => {
    serveExploreLists({ 0: [identified(), anonymous()] });
    renderWith(<ListResults query="books" />);
    expect(await screen.findByText('Books to reread')).toBeTruthy();
    expect(h.rpc).toHaveBeenCalledWith('get_explore_lists', expect.objectContaining({ p_query: 'books', p_limit: 20 }));
  });

  it('search waits for two characters', () => {
    renderWith(<ListResults query="b" />);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('Home shows lively lists from others, anonymous included, and sees all in Explore', async () => {
    h.rpc.mockResolvedValue({
      data: [identified(), anonymous(), identified({ list_id: 'tiny', list_name: 'Tiny', item_count: 1 }), identified({ list_id: 'mine', user_id: 'me', list_name: 'Mine' })],
      error: null,
    });
    renderWith(<CommunityListsSection />);
    expect(await screen.findByText('Natural wines')).toBeTruthy();
    expect(screen.getByText('Books to reread')).toBeTruthy();
    expect(screen.queryByText('Tiny')).toBeNull();
    expect(screen.queryByText('Mine')).toBeNull();
    expect(screen.getByRole('link', { name: /see all/i }).getAttribute('href')).toBe('/explore?c=lists');
  });
});

// ---------------------------------------------------------------------------
// Anonymous view
// ---------------------------------------------------------------------------

const discoverable = {
  token: TOKEN,
  title: 'Books to reread',
  icon: '📚',
  rating_mode: 'stars_5' as const,
  statuses: ['To read', 'Read'],
  types: [{ name: 'Novel', icon: '📖', color: null }],
  items: [
    { name: 'Middlemarch', status: 'Read', types: ['Novel'], rating: 5 },
    { name: 'Dune', status: 'To read', types: [], rating: null },
  ],
  is_owner: false,
};

describe('DiscoverableListView', () => {
  it('renders only the allowlisted fields, even if a response carried more', () => {
    const leaky = {
      ...discoverable,
      owner: 'priya',
      user_id: 'priya-id',
      items: discoverable.items.map((i) => ({ ...i, notes: 'SECRET NOTE', address: '1 Secret St', image_url: 'https://x/p.jpg' })),
    };
    const { container } = renderWith(<DiscoverableListView list={leaky} />);
    expect(screen.getByText('Middlemarch')).toBeTruthy();
    expect(screen.getByText('Dune')).toBeTruthy();
    expect(screen.getByText(/Shared anonymously/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/SECRET NOTE|Secret St|priya/);
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('DiscoverableListPage', () => {
  const page = () =>
    renderWith(
      <Routes>
        <Route path="/lists/discover/:token" element={<DiscoverableListPage />} />
      </Routes>,
      `/lists/discover/${TOKEN}`,
    );

  it('shows the list and a Report action to other members', async () => {
    h.rpc.mockResolvedValue({ data: discoverable, error: null });
    page();
    expect(await screen.findByText('Middlemarch')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Report/ })).toBeTruthy();
    expect(h.rpc).toHaveBeenCalledWith('get_discoverable_list', { p_token: TOKEN });
  });

  it('says a revoked list is not available', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    page();
    expect(await screen.findByText("This list isn't available")).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Report/ })).toBeNull();
  });

  it('sends signed-out visitors to sign in without asking the server', async () => {
    h.user = null;
    page();
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/auth'));
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Choosing visibility
// ---------------------------------------------------------------------------

describe('ListVisibilityControl', () => {
  const base = {
    onChange: vi.fn(),
    listName: 'Books to reread',
    consent: false,
    onConsentChange: vi.fn(),
  };

  it('public account: no anonymous option', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ListVisibilityControl {...base} value="profile" isPrivateAccount={false} needsConsent={false} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('radio', { name: /Visible to everyone/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('radio', { name: /Discoverable anonymously/ })).toBeNull();
  });

  it('anonymous: explains what is shown and hidden, warns about identifying text, asks for consent, previews', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ListVisibilityControl {...base} value="anonymous" isPrivateAccount needsConsent />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Others will see')).toBeTruthy();
    expect(screen.getByText('Never shown')).toBeTruthy();
    expect(screen.getByText('Your name, username and profile')).toBeTruthy();
    expect(screen.getByText(/item names are shown exactly as you write them/)).toBeTruthy();
    expect(screen.getByLabelText(/without my name/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Preview what others will see/ }));
    expect(screen.getByText('Books to reread')).toBeTruthy();
    expect(screen.getByText(/Shared anonymously/)).toBeTruthy();
  });
});

describe('CreateListDialog privacy', () => {
  const editList = (over: Partial<CustomList> = {}): CustomList => ({
    id: 'list-1',
    name: 'Books to reread',
    icon: '📚',
    color: '#000',
    show_location: false,
    show_price: false,
    price_mode: 'dollar',
    show_rating: true,
    rating_mode: 'stars_5',
    show_notes: true,
    show_photos: true,
    visibility: 'profile',
    discovery_token: TOKEN,
    status_todo_label: '',
    status_done_label: '',
    ...over,
  });

  function mockUpdate() {
    const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
    h.from.mockReturnValue({ update });
    return update;
  }

  const open = (list: CustomList) =>
    renderWith(<CreateListDialog open onOpenChange={() => {}} onSuccess={() => {}} editList={list} />);

  it('will not make a list anonymous until the person ticks the consent box', async () => {
    h.isPrivate = true;
    const update = mockUpdate();
    open(editList());
    fireEvent.click(screen.getByRole('radio', { name: /Discoverable anonymously/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(h.toastError).toHaveBeenCalledWith(expect.stringMatching(/confirm anonymous sharing/));
    expect(update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/without my name/));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'anonymous' })));
  });

  it('saving other settings never rewrites who can see a private list', async () => {
    h.isPrivate = true;
    const update = mockUpdate();
    open(editList({ visibility: 'private' }));
    expect(screen.getByRole('radio', { name: /Only me/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.change(screen.getByPlaceholderText(/Movies, Beers/), { target: { value: 'Rereads' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    const payload = (update.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.name).toBe('Rereads');
    expect(payload).not.toHaveProperty('visibility');
  });

  it('an anonymous list can be withdrawn at once, without another consent step', async () => {
    h.isPrivate = true;
    const update = mockUpdate();
    open(editList({ visibility: 'anonymous' }));
    expect(screen.queryByLabelText(/without my name/)).toBeNull(); // already consented
    fireEvent.click(screen.getByRole('radio', { name: /Only me/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' })));
  });

  it('a public account sees its two plain choices', () => {
    h.isPrivate = false;
    mockUpdate();
    open(editList());
    expect(screen.getByRole('radio', { name: /Visible to everyone/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Only me/ })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Discoverable anonymously/ })).toBeNull();
  });
});
