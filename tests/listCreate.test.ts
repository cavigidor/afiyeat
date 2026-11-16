import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createDemoFetch, type DemoDb } from '@/demo/backend';

// createListFromPreset runs against the demo backend (a PostgREST emulator), with a failure switch
// per table to check the partial-failure paths.
const BASE = 'https://demo.afiyeat.invalid';
const USER = '00000000-0000-4000-8000-0000000000d1';
let db: DemoDb;
const failures: Record<string, number> = {};
let lostListResponse = false;

vi.mock('@/integrations/supabase/client', () => {
  const inner = () => createDemoFetch({ baseUrl: BASE, user: { id: USER, email: 'd@x.test' }, db });
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const table = url.match(/\/rest\/v1\/([a-z_]+)/)?.[1] ?? '';
    const method = init?.method ?? 'GET';
    if (method === 'POST' && failures[table]) { failures[table]--; return new Response(JSON.stringify({ code: '08006', message: 'network' }), { status: 503 }); }
    const res = await inner()(input, init);
    if (lostListResponse && method === 'POST' && table === 'custom_lists') { lostListResponse = false; throw new TypeError('Load failed'); }
    return res;
  };
  return { supabase: createClient(BASE, 'k', { auth: { persistSession: false }, global: { fetch } }) };
});

const { createListFromPreset } = await import('@/lib/listCreate');
const { V2_PRESETS } = await import('@/lib/listPresets');
const preset = (k: string) => V2_PRESETS.find((p) => p.key === k)!;

beforeEach(() => {
  db = { custom_lists: [], custom_list_statuses: [], custom_list_types: [], custom_list_items: [] };
  for (const k of Object.keys(failures)) delete failures[k];
  lostListResponse = false;
});

describe('createListFromPreset', () => {
  it('creates the list with the preset setup, statuses in order and categories in order', async () => {
    const r = await createListFromPreset(USER, preset('drinks'), '  Drinks  ');
    expect(r).toMatchObject({ status: 'created', categoriesMissing: false });
    expect(db.custom_lists).toHaveLength(1);
    expect(db.custom_lists[0]).toMatchObject({ name: 'Drinks', icon: '🍸', show_location: false, show_price: true, price_mode: 'manual', show_rating: true, visibility: 'profile' });
    expect(db.custom_list_statuses.map((s) => [s.name, s.sort_order])).toEqual([['Want to Try', 0], ['Tried', 1]]);
    expect(db.custom_list_types.map((t) => t.name)).toEqual(['Beer', 'Wine', 'Cocktails', 'Spirits', 'Non-alcoholic']);
  });

  it('Travel starts as Only me; other presets keep the default; an explicit choice wins', async () => {
    await createListFromPreset(USER, preset('travel'), 'Travel', { extraCategories: ['Lisbon, Portugal', ' '] });
    expect(db.custom_lists[0].visibility).toBe('private');
    expect(db.custom_list_types.map((t) => t.name)).toEqual(['Lisbon, Portugal']);
    await createListFromPreset(USER, preset('stores'), 'Shops');
    expect(db.custom_lists[1].visibility).toBe('profile');
    await createListFromPreset(USER, preset('travel'), 'Shared trip', { visibility: 'profile' });
    expect(db.custom_lists[2].visibility).toBe('profile');
  });

  it('a lost response followed by a retry with the same id makes one list, not two', async () => {
    lostListResponse = true;
    // The list was written but the answer was lost: the person sees an error and taps Create again.
    expect((await createListFromPreset(USER, preset('coffee_beans'), 'Beans', { id: 'fixed-id-1' })).status).toBe('error');
    expect(db.custom_lists).toHaveLength(1);
    const r = await createListFromPreset(USER, preset('coffee_beans'), 'Beans', { id: 'fixed-id-1' });
    expect(r.status).toBe('created');
    expect(db.custom_lists).toHaveLength(1);
    expect(db.custom_list_statuses).toHaveLength(2);
    expect(db.custom_list_types).toHaveLength(3);
  });

  it('statuses failing twice removes the half-made list and reports an error', async () => {
    failures.custom_list_statuses = 2;
    const r = await createListFromPreset(USER, preset('restaurants'), 'Date night');
    expect(r.status).toBe('error');
    expect(db.custom_lists).toHaveLength(0);
  });

  it('statuses failing once is retried and succeeds', async () => {
    failures.custom_list_statuses = 1;
    expect((await createListFromPreset(USER, preset('restaurants'), 'Date night')).status).toBe('created');
    expect(db.custom_list_statuses).toHaveLength(2);
  });

  it('categories failing twice keeps the list and says categories are missing', async () => {
    failures.custom_list_types = 2;
    const r = await createListFromPreset(USER, preset('stores'), 'Shops');
    expect(r).toMatchObject({ status: 'created', categoriesMissing: true });
    expect(db.custom_lists).toHaveLength(1);
    expect(db.custom_list_types).toHaveLength(0);
  });
});
