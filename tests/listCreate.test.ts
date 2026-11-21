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
const missingTables = new Set<string>();

vi.mock('@/integrations/supabase/client', () => {
  const inner = () => createDemoFetch({ baseUrl: BASE, user: { id: USER, email: 'd@x.test' }, db });
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const table = url.match(/\/rest\/v1\/([a-z_]+)/)?.[1] ?? '';
    const method = init?.method ?? 'GET';
    if (missingTables.has(table)) return new Response(JSON.stringify({ code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` }), { status: 404 });
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
  db = { custom_lists: [], custom_list_statuses: [], custom_list_types: [], custom_list_items: [], custom_list_owner_settings: [] };
  for (const k of Object.keys(failures)) delete failures[k];
  lostListResponse = false;
  missingTables.clear();
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
    // Item details are available here, so the Roast field stands in for the roast categories.
    expect(db.custom_list_types).toHaveLength(0);
    expect(db.custom_list_owner_settings).toHaveLength(1);
  });

  it('saves the preset\'s item fields with the list, and Coffee Beans gets one roast control, not two', async () => {
    const r = await createListFromPreset(USER, preset('coffee_beans'), 'Beans');
    expect(r).toMatchObject({ status: 'created', categoriesMissing: false, fields: 'saved' });
    const fields = (db.custom_list_owner_settings[0] as { fields: { key: string; options?: string[] }[] }).fields;
    expect(fields.map((f) => f.key)).toContain('c_roast');
    expect(fields.find((f) => f.key === 'c_roast')?.options).toEqual(['Light', 'Light-Medium', 'Medium', 'Medium-Dark', 'Dark', 'Extra Dark']);
    expect(db.custom_list_types.filter((t) => /roast/i.test(String(t.name)))).toHaveLength(0);
  });

  it('a genuine failure to save the item fields is reported (after one retry); the list falls back to roast categories', async () => {
    failures.custom_list_owner_settings = 2;
    const r = await createListFromPreset(USER, preset('coffee_beans'), 'Beans');
    expect(r).toMatchObject({ status: 'created', categoriesMissing: false, fields: 'failed' });
    expect(db.custom_lists).toHaveLength(1);
    expect(db.custom_list_types.map((t) => t.name)).toEqual(['Light roast', 'Medium roast', 'Dark roast']);
    expect(db.custom_list_owner_settings).toHaveLength(0);
  });

  it('one dropped answer is retried and the fields still save', async () => {
    failures.custom_list_owner_settings = 1;
    const r = await createListFromPreset(USER, preset('coffee_beans'), 'Beans');
    expect(r).toMatchObject({ fields: 'saved' });
    expect(db.custom_list_owner_settings).toHaveLength(1);
  });

  it('the retry offered afterwards adds the fields with Roast hidden, so the roast categories stay the only roast control', async () => {
    failures.custom_list_owner_settings = 2;
    const r = await createListFromPreset(USER, preset('coffee_beans'), 'Beans');
    const { savePresetFields } = await import('@/lib/listCreate');
    expect(await savePresetFields(USER, (r as { id: string }).id, preset('coffee_beans'), ['Light roast', 'Medium roast', 'Dark roast'])).toBe('saved');
    const fields = (db.custom_list_owner_settings[0] as { fields: { key: string; hidden?: boolean }[] }).fields;
    expect(fields.find((f) => f.key === 'c_roast')?.hidden).toBe(true);
  });

  it('where item details don\'t exist yet (production today), lists are made exactly as before', async () => {
    missingTables.add('custom_list_owner_settings');
    const r = await createListFromPreset(USER, preset('coffee_beans'), 'Beans');
    expect(r).toMatchObject({ status: 'created', categoriesMissing: false, fields: 'unavailable' });
    expect(db.custom_list_types.map((t) => t.name)).toEqual(['Light roast', 'Medium roast', 'Dark roast']);
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
