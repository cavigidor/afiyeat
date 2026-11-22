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

const { createListFromPreset, savePresetFields } = await import('@/lib/listCreate');
const { V2_PRESETS, MORE_PRESETS } = await import('@/lib/listPresets');
const { fieldsForPreset } = await import('@/lib/presetFields');
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

describe('createListFromPreset with what was kept selected on the sheet', () => {
  const settingsKeys = () => (db.custom_list_owner_settings[0] as { fields: { key: string }[] } | undefined)?.fields.map((f) => f.key) ?? [];
  const names = (t: string) => db[t].map((r) => r.name);
  const defaults = (k: string) => {
    const p = preset(k) ?? MORE_PRESETS.find((x) => x.key === k)!;
    return {
      statuses: [...p.statuses], categories: p.categories.map((c) => c.name), fieldKeys: fieldsForPreset(p.key).map((f) => f.key),
      tracks: { show_location: p.config.show_location, show_price: p.config.show_price, show_rating: p.config.show_rating, show_photos: p.config.show_photos, show_notes: p.config.show_notes },
    };
  };

  it('nothing changed gives exactly the same list as before the chips existed', async () => {
    await createListFromPreset(USER, preset('drinks'), 'Drinks', { id: 'a' });
    const before = JSON.stringify({ l: db.custom_lists.map(({ id, created_at, updated_at, discovery_token, ...r }) => r), s: names('custom_list_statuses'), t: names('custom_list_types'), f: settingsKeys() });
    for (const t of Object.keys(db)) db[t] = [];
    await createListFromPreset(USER, preset('drinks'), 'Drinks', { id: 'b', selection: defaults('drinks') });
    const after = JSON.stringify({ l: db.custom_lists.map(({ id, created_at, updated_at, discovery_token, ...r }) => r), s: names('custom_list_statuses'), t: names('custom_list_types'), f: settingsKeys() });
    expect(JSON.parse(after)).toEqual(JSON.parse(before));
  });

  it('saves only the selected statuses, categories, fields and tracking, in the preset\'s order', async () => {
    const sel = defaults('drinks');
    const r = await createListFromPreset(USER, preset('drinks'), 'Drinks', {
      selection: { ...sel, statuses: ['Tried'], categories: ['Wine', 'Beer'], fieldKeys: ['c_vintage', 'c_brewery'], tracks: { ...sel.tracks, show_photos: false, show_location: true } },
    });
    expect(r).toMatchObject({ status: 'created', fields: 'saved', categoryNames: ['Beer', 'Wine'] });
    expect(names('custom_list_statuses')).toEqual(['Tried']);
    expect(names('custom_list_types')).toEqual(['Beer', 'Wine']);
    expect(settingsKeys()).toEqual(['c_brewery', 'c_vintage']);
    expect(db.custom_lists[0]).toMatchObject({ show_photos: false, show_location: true, show_rating: true });
  });

  it('refuses to create a list with no status', async () => {
    const r = await createListFromPreset(USER, preset('movies'), 'Movies', { selection: { ...defaults('movies'), statuses: [] } });
    expect(r.status).toBe('error');
    expect(db.custom_lists).toHaveLength(0);
  });

  it('all details deselected: no field definitions at all, and Coffee Beans gets no roast categories', async () => {
    const r = await createListFromPreset(USER, preset('coffee_beans'), 'Beans', {
      selection: { ...defaults('coffee_beans'), categories: [], categoriesIfNoFields: [], fieldKeys: [] },
    });
    expect(r).toMatchObject({ fields: 'none', categoryNames: [] });
    expect(db.custom_list_owner_settings).toHaveLength(0);
    expect(db.custom_list_types).toHaveLength(0);
  });

  it('a failed field save never brings back deselected fields: the in-call retry sends the same selection', async () => {
    failures.custom_list_owner_settings = 1;
    await createListFromPreset(USER, preset('coffee_beans'), 'Beans', {
      selection: { ...defaults('coffee_beans'), categories: [], categoriesIfNoFields: [], fieldKeys: ['c_roaster', 'c_origin'] },
    });
    expect(settingsKeys()).toEqual(['c_roaster', 'c_origin']);
  });

  it('Coffee Beans, Roast deselected and the fields fail: no roast categories are recreated', async () => {
    failures.custom_list_owner_settings = 2;
    const r = await createListFromPreset(USER, preset('coffee_beans'), 'Beans', {
      selection: { ...defaults('coffee_beans'), categories: [], categoriesIfNoFields: [], fieldKeys: ['c_roaster'] },
    });
    expect(r).toMatchObject({ fields: 'failed', categoryNames: [] });
    expect(db.custom_list_types).toHaveLength(0);
  });

  it('Coffee Beans, Roast kept and the fields fail: roast categories as the fallback; the later retry adds only the selected fields, Roast hidden', async () => {
    failures.custom_list_owner_settings = 2;
    const keys = ['c_roaster', 'c_roast'];
    const r = await createListFromPreset(USER, preset('coffee_beans'), 'Beans', {
      selection: { ...defaults('coffee_beans'), categories: [], categoriesIfNoFields: ['Light roast', 'Medium roast', 'Dark roast'], fieldKeys: keys },
    });
    expect(r).toMatchObject({ fields: 'failed', categoryNames: ['Light roast', 'Medium roast', 'Dark roast'] });
    expect(await savePresetFields(USER, (r as { id: string }).id, preset('coffee_beans'), (r as { categoryNames: string[] }).categoryNames, keys)).toBe('saved');
    const fields = (db.custom_list_owner_settings[0] as { fields: { key: string; hidden?: boolean }[] }).fields;
    expect(fields.map((f) => f.key)).toEqual(keys);
    expect(fields.find((f) => f.key === 'c_roast')?.hidden).toBe(true);
  });

  it('the same selection on every preset, More presets included, creates without error', async () => {
    for (const p of [...V2_PRESETS, ...MORE_PRESETS]) {
      for (const t of Object.keys(db)) db[t] = [];
      const r = await createListFromPreset(USER, p, p.label, { selection: defaults(p.key) });
      expect(r, p.key).toMatchObject({ status: 'created' });
      expect(names('custom_list_statuses'), p.key).toEqual(p.statuses);
    }
  });
});

