// Regression: editing a Been There place must keep its original visit date.
// Before the fix, every save of a Been There place wrote visited_at = now, so editing
// only the notes replaced the real visit date (found in the real-data compatibility run).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { visitedAtForEdit } from '@/lib/visitDate';

// A Supabase stand-in that records every update payload and answers reads with nothing.
const db = vi.hoisted(() => ({ updates: [] as { table: string; payload: Record<string, unknown> }[] }));
vi.mock('@/integrations/supabase/client', () => {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    const done = Promise.resolve({ data: [], error: null });
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'neq', 'is', 'match']) q[m] = () => q;
    q.then = done.then.bind(done);
    q.maybeSingle = async () => ({ data: null, error: null });
    q.single = async () => ({ data: null, error: null });
    q.update = (payload: Record<string, unknown>) => {
      db.updates.push({ table, payload });
      return { eq: async () => ({ data: null, error: null }) };
    };
    return q;
  };
  return {
    supabase: {
      from: (t: string) => chain(t),
      storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }), createSignedUrl: async () => ({ data: null, error: null }) }) },
      functions: { invoke: async () => ({ data: null, error: null }) },
    },
  };
});
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The photo section isn't involved in the visit date.
vi.mock('@/components/restaurants/ImageUploadSection', () => ({ ImageUploadSection: () => null }));

import { EditRestaurantDialog } from '@/components/restaurants/EditRestaurantDialog';
import { EditSharedItemDialog } from '@/components/shared/EditSharedItemDialog';

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const VISITED = '2026-02-11T19:00:00.000Z';

describe('visitedAtForEdit', () => {
  const now = new Date('2026-11-20T20:00:00.000Z');
  it('leaves visited_at out when a Been There place stays Been There', () => {
    expect(visitedAtForEdit('went_to', 'went_to', now)).toEqual({});
  });
  it('stamps now when a place becomes Been There', () => {
    expect(visitedAtForEdit('to_go', 'went_to', now)).toEqual({ visited_at: now.toISOString() });
    expect(visitedAtForEdit(undefined, 'went_to', now)).toEqual({ visited_at: now.toISOString() });
  });
  it('clears visited_at when a place goes back to To Go', () => {
    expect(visitedAtForEdit('went_to', 'to_go', now)).toEqual({ visited_at: null });
    expect(visitedAtForEdit('to_go', 'to_go', now)).toEqual({ visited_at: null });
  });
});

describe('Edit place keeps the original visit date', () => {
  beforeEach(() => { db.updates.length = 0; });

  it('My Restaurants: saving a Been There place unchanged does not touch visited_at', async () => {
    wrap(
      <EditRestaurantDialog
        open
        onOpenChange={() => {}}
        onSuccess={() => {}}
        folders={[]}
        restaurant={{ id: 'r1', name: 'Mikla', status: 'went_to', notes: 'old note', rating: 9, price_level: 3, folder_ids: [], images: [] }}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('old note'), { target: { value: 'new note' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(db.updates).toHaveLength(1));
    const { table, payload } = db.updates[0];
    expect(table).toBe('restaurants');
    expect(payload.notes).toBe('new note');
    expect(payload.status).toBe('went_to');
    expect('visited_at' in payload).toBe(false);
  });

  it('My Restaurants: a To Go place saved as To Go keeps visited_at null', async () => {
    wrap(
      <EditRestaurantDialog
        open
        onOpenChange={() => {}}
        onSuccess={() => {}}
        folders={[]}
        restaurant={{ id: 'r2', name: 'Karaköy Lokantası', status: 'to_go', notes: null, folder_ids: [], images: [] }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(db.updates).toHaveLength(1));
    expect(db.updates[0].payload.visited_at).toBeNull();
  });

  it('Shared list: saving a Been There item unchanged does not touch visited_at', async () => {
    wrap(
      <EditSharedItemDialog
        open
        onOpenChange={() => {}}
        onSuccess={() => {}}
        item={{ id: 's1', name: 'Balıkçı Sabahattin', address: null, status: 'went_to', rating: 8, price_level: 2, notes: 'fish' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(db.updates).toHaveLength(1));
    const { table, payload } = db.updates[0];
    expect(table).toBe('shared_list_items');
    expect('visited_at' in payload).toBe(false);
  });

  it('documents the original value the fix protects', () => {
    // A Been There row as stored; nothing in an unchanged edit may overwrite this.
    const row = { status: 'went_to', visited_at: VISITED };
    expect({ ...row, ...visitedAtForEdit(row.status, 'went_to') }.visited_at).toBe(VISITED);
  });
});
