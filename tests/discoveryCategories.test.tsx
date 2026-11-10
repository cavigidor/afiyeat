/**
 * CP4 client behaviour: one category rule shared by Home and Explore
 * (list, map and "Most visited" rail), saved-to-visit vs visited, one card
 * per place, the fallback before the migration is applied, and Events
 * left as it was. What the server returns is covered by
 * discoveryPlaces.db.test.ts; the classifier by placeClassification.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  mapPlaces: [] as { place_id: string }[],
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' }, loading: false }) }));
vi.mock('@/components/layout/Navbar', () => ({ Navbar: () => null }));
vi.mock('@/components/explore/ExploreMapComponent', () => ({
  ExploreMapComponent: ({ places }: { places: { place_id: string }[] }) => {
    h.mapPlaces = places;
    return <div data-testid="map">{places.length} pins</div>;
  },
}));
vi.mock('@/components/explore/ExploreEvents', () => ({
  ExploreEvents: ({ keyword }: { keyword?: string }) => <div data-testid="events">events:{keyword ?? ''}</div>,
}));
vi.mock('@/components/explore/AddExplorePlaceDialog', () => ({ AddExplorePlaceDialog: () => null }));
vi.mock('@/components/explore/PlaceDetailSheet', () => ({ PlaceDetailSheet: () => null }));
vi.mock('@/pages/Recipes', () => ({ default: () => <div>recipes</div> }));

import {
  DISCOVERY_CATEGORIES,
  ENABLED_CATEGORIES,
  compareInCategory,
  emojiForPlace,
  exploreCategoryPath,
  fetchDiscoveryPlaces,
  placesForSelection,
  rankPopularPlaces,
  selectionFromSearch,
  toDiscoveryPlace,
  type DiscoveryPlace,
} from '@/lib/discovery';
import { CategoryTiles, CategoryChips } from '@/components/discovery/CategoryRail';
import { ExplorePlaceCard } from '@/components/explore/ExplorePlaceCard';
import Explore from '@/pages/Explore';

type Raw = Parameters<typeof toDiscoveryPlace>[0];

const raw = (place_id: string, name: string, extra: Partial<Raw> = {}): Raw => ({
  place_id,
  name,
  address: '1 Main St, Chicago, IL 60607, United States',
  latitude: 41.88,
  longitude: -87.63,
  category: null,
  price_level: null,
  avg_rating: null,
  rating_count: 0,
  contributor_count: 1,
  saved_count: 0,
  type_names: [],
  apple_place_id: null,
  ...extra,
});

// What get_discovery_places returns for a small community (string counts,
// as PostgREST sends numerics).
const RAW: Raw[] = [
  raw('A1', 'Girl & the Goat', { category: 'Restaurant', contributor_count: 4, avg_rating: 9, rating_count: 4 }),
  raw('A2', 'Sawada Coffee', { category: 'Cafe', contributor_count: 2, avg_rating: 8, rating_count: 2 }),
  raw('A3', 'The Violet Hour', { category: 'Nightlife', contributor_count: 3, avg_rating: 9.5, rating_count: 3 }),
  raw('A4', 'Café Mustache', { category: 'Cafe', type_names: ['Brunch'], contributor_count: 2 }),
  raw('A5', 'Lost Lake', { type_names: ['Bar'], contributor_count: 0, saved_count: 3 }),
  raw('A6', 'Intelligentsia Coffee', { contributor_count: 0, saved_count: 1 }),
  raw('A7', 'Art Institute of Chicago', { category: 'Museum', contributor_count: 5 }),
  raw('A8', 'Alinea', { contributor_count: '1' as unknown as number }),
  raw('S1', 'Starbucks', { category: 'Cafe', contributor_count: 1 }),
  raw('S2', 'Starbucks', { category: 'Cafe', contributor_count: 1, address: '9 Other St, Chicago, IL 60601, United States' }),
];
const PLACES: DiscoveryPlace[] = RAW.map(toDiscoveryPlace);
const ids = (places: { place_id: string }[]) => places.map((p) => p.place_id);

beforeEach(() => {
  h.rpc.mockReset();
  h.from.mockReset();
  h.mapPlaces = [];
  h.rpc.mockImplementation(async (fn: string) =>
    fn === 'get_discovery_places' ? { data: RAW, error: null } : { data: [], error: null },
  );
});

describe('placesForSelection: one rule for every surface', () => {
  it('puts each place where it belongs, in several categories when the evidence is strong', () => {
    expect(ids(placesForSelection(PLACES, 'food'))).toEqual(['A1', 'A4']);
    expect(ids(placesForSelection(PLACES, 'coffee'))).toEqual(['A2', 'A4', 'S1', 'S2', 'A6']);
    expect(ids(placesForSelection(PLACES, 'drinks'))).toEqual(['A3', 'A5']);
  });

  it('6. a museum never lands in Food, but is still under All', () => {
    for (const c of ['food', 'coffee', 'drinks'] as const) {
      expect(ids(placesForSelection(PLACES, c))).not.toContain('A7');
    }
    expect(ids(placesForSelection(PLACES, 'all'))).toContain('A7');
  });

  it('5. a hand-typed place with nothing to go on is under All only, not guessed as Food', () => {
    for (const c of ['food', 'coffee', 'drinks'] as const) {
      expect(ids(placesForSelection(PLACES, c))).not.toContain('A8');
    }
    expect(ids(placesForSelection(PLACES, 'all'))).toContain('A8');
  });

  it('12. places people have been to come before want-to-go saves', () => {
    const coffee = placesForSelection(PLACES, 'coffee');
    const firstSaved = coffee.findIndex((p) => Number(p.contributor_count) === 0);
    expect(coffee.slice(0, firstSaved).every((p) => Number(p.contributor_count) > 0)).toBe(true);
    expect(coffee.slice(firstSaved).every((p) => Number(p.contributor_count) === 0)).toBe(true);
  });

  it('12. want-to-go saves are never "popular" on Home or in "Most visited"', () => {
    const ranked = rankPopularPlaces(PLACES, { origin: null, excludeAppleIds: new Set(), excludeNames: new Set() });
    expect(ids(ranked.places)).not.toContain('A5');
    expect(ids(ranked.places)).not.toContain('A6');
  });

  it('11. one card per place, and same-name venues are never merged', () => {
    const twice = [...PLACES, PLACES[1]];
    expect(ids(placesForSelection(twice, 'coffee')).filter((id) => id === 'A2')).toHaveLength(1);
    expect(ids(placesForSelection(PLACES, 'coffee')).filter((id) => id.startsWith('S'))).toEqual(['S1', 'S2']);
  });

  it('ordering is deterministic', () => {
    const shuffled = [...PLACES].reverse();
    expect(ids(placesForSelection(shuffled, 'coffee'))).toEqual(ids(placesForSelection(PLACES, 'coffee')));
    expect([...PLACES].sort(compareInCategory('all'))).toEqual([...shuffled].sort(compareInCategory('all')));
  });

  it('16. Events is not a place category and is unchanged', () => {
    expect(placesForSelection(PLACES, 'events')).toEqual([]);
    expect(DISCOVERY_CATEGORIES.find((c) => c.id === 'events')).toMatchObject({ label: 'Events', source: 'events', enabled: true });
    expect(selectionFromSearch('?c=events&q=jazz')).toBe('events');
  });

  it('emoji never assumes food for an unknown place', () => {
    expect(emojiForPlace('Museum')).toBe('📍');
    expect(emojiForPlace(null)).toBe('📍');
    expect(emojiForPlace(null, 'Alinea')).toBe('📍');
    expect(emojiForPlace(null, "Lou Malnati's Pizzeria")).toBe('🍽️');
    expect(emojiForPlace('Cafe')).toBe('☕');
  });
});

describe('labels', () => {
  it('uses the full category names', () => {
    expect(ENABLED_CATEGORIES.map((c) => c.label)).toEqual(['Food & Restaurants', 'Coffee & Cafés', 'Bars & Drinks', 'Events']);
  });
});

describe('fetchDiscoveryPlaces', () => {
  it('classifies rows from get_discovery_places', async () => {
    const places = await fetchDiscoveryPlaces('all');
    expect(h.rpc).toHaveBeenCalledWith('get_discovery_places', { p_mode: 'all' });
    expect(places.find((p) => p.place_id === 'A5')?.classification.categories).toEqual(['drinks']);
    expect(places.find((p) => p.place_id === 'A8')?.contributor_count).toBe(1);
  });

  it('falls back to get_explore_places until the migration is applied', async () => {
    h.rpc.mockImplementation(async (fn: string) =>
      fn === 'get_discovery_places'
        ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.get_discovery_places' } }
        : { data: [RAW[0], RAW[1]], error: null },
    );
    const places = await fetchDiscoveryPlaces('friends');
    expect(h.rpc).toHaveBeenCalledWith('get_explore_places', { p_mode: 'friends' });
    expect(ids(places)).toEqual(['A1', 'A2']);
    expect(places[1].classification.categories).toEqual(['coffee']);
  });

  it('surfaces any other error instead of falling back', async () => {
    h.rpc.mockImplementation(async () => ({ data: null, error: { code: '42501', message: 'permission denied' } }));
    await expect(fetchDiscoveryPlaces('all')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('cards', () => {
  it('a want-to-go place is never shown as an endorsement', () => {
    render(<ExplorePlaceCard place={PLACES.find((p) => p.place_id === 'A5')!} />);
    expect(screen.getByText('Not visited yet')).toBeTruthy();
    expect(screen.getByText('3 want to go')).toBeTruthy();
    expect(screen.queryByText(/been here/)).toBeNull();
  });

  it('a visited place shows who has been', () => {
    render(<ExplorePlaceCard place={PLACES[0]} />);
    expect(screen.getByText('4 been here')).toBeTruthy();
    expect(screen.queryByText('Not visited yet')).toBeNull();
  });
});

function renderApp(initial: string, children?: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/" element={<CategoryTiles />} />
          <Route path="/explore" element={<Explore />} />
        </Routes>
        {children}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('15. Home shortcuts and Explore filters agree', () => {
  it('each Home tile links to the Explore selection with the same id', () => {
    renderApp('/');
    for (const c of ENABLED_CATEGORIES) {
      const link = screen.getByRole('link', { name: new RegExp(c.label) });
      expect(link.getAttribute('href')).toBe(exploreCategoryPath(c.id));
      expect(selectionFromSearch(new URL(link.getAttribute('href')!, 'https://x').search)).toBe(c.id);
    }
  });

  it.each(['food', 'coffee', 'drinks'] as const)(
    'tapping %s on Home shows exactly placesForSelection in Explore (list and map)',
    async (category) => {
      renderApp('/');
      const label = ENABLED_CATEGORIES.find((c) => c.id === category)!.label;
      fireEvent.click(screen.getByRole('link', { name: new RegExp(label) }));

      const expected = placesForSelection(PLACES, category);
      // Map view first: the map gets the same places.
      await waitFor(() => expect(screen.getByTestId('map').textContent).toBe(`${expected.length} pins`));
      expect(ids(h.mapPlaces)).toEqual(ids(expected));
      expect(screen.getByRole('tab', { name: new RegExp(label), selected: true })).toBeTruthy();

      // List view: the same places, in the same order.
      fireEvent.mouseDown(screen.getByRole('tab', { name: /List/ }));
      fireEvent.click(screen.getByRole('tab', { name: /List/ }));
      await waitFor(() => expect(screen.getAllByRole('heading', { level: 3 }).length).toBe(expected.length));
      expect(screen.getAllByRole('heading', { level: 3 }).map((el) => el.textContent)).toEqual(expected.map((p) => p.name));
    },
  );

  it('splits Been there from Saved to visit in the list', async () => {
    renderApp('/explore?c=drinks');
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /List/ }));
    fireEvent.click(screen.getByRole('tab', { name: /List/ }));
    const been = await screen.findByRole('region', { name: 'Been there' });
    const saved = screen.getByRole('region', { name: 'Saved to visit' });
    expect(within(been).getByText('The Violet Hour')).toBeTruthy();
    expect(within(saved).getByText('Lost Lake')).toBeTruthy();
  });

  it('shows an honest empty state instead of unrelated places', async () => {
    h.rpc.mockImplementation(async () => ({ data: [RAW[6]], error: null })); // only the museum
    renderApp('/explore?c=food');
    expect(await screen.findByText('Nothing here yet')).toBeTruthy();
    expect(screen.queryByText('Art Institute of Chicago')).toBeNull();
    expect(screen.queryByTestId('map')).toBeNull();
  });

  it('16. Events still opens the events view with its keyword', async () => {
    renderApp('/explore?c=events&q=jazz');
    expect((await screen.findByTestId('events')).textContent).toBe('events:jazz');
    expect(screen.queryByTestId('map')).toBeNull();
    expect(screen.queryByText('Nothing here yet')).toBeNull();
  });
});

describe('chips', () => {
  it('Explore chips list All then every enabled category', () => {
    render(<CategoryChips value="coffee" onChange={() => {}} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      '✨All',
      ...ENABLED_CATEGORIES.map((c) => `${c.emoji}${c.label}`),
    ]);
    expect(screen.getByRole('tab', { name: 'Coffee & Cafés', selected: true })).toBeTruthy();
  });
});
