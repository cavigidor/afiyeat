import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createDemoFetch, type DemoDb } from '@/demo/backend';

// Exercised through the real supabase-js client, so these are the requests the app actually sends.
const BASE = 'https://demo.afiyeat.invalid';
const USER = { id: '00000000-0000-4000-8000-0000000000d1', email: 'demo@example.test' };

function setup(db: DemoDb) {
  const fetch = createDemoFetch({ baseUrl: BASE, user: USER, db, rpc: { get_shared_preview: () => null } });
  const client = createClient(BASE, 'demo-anon-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch } });
  return { client, db };
}

const seed = (): DemoDb => ({
  custom_lists: [
    { id: 'L1', user_id: USER.id, name: 'Wines', icon: '🍷', color: '#7a1f3d', created_at: '2026-01-02T00:00:00Z', show_rating: true, visibility: 'profile' },
    { id: 'L2', user_id: USER.id, name: 'Books', icon: '📚', color: '#334155', created_at: '2026-01-03T00:00:00Z', show_rating: true, visibility: 'private' },
    { id: 'L3', user_id: 'someone-else', name: 'Theirs', icon: '📋', color: '#000', created_at: '2026-01-04T00:00:00Z', show_rating: false, visibility: 'profile' },
  ],
  custom_list_statuses: [
    { id: 'S1', list_id: 'L1', user_id: USER.id, name: 'Want to Try', sort_order: 0 },
    { id: 'S2', list_id: 'L1', user_id: USER.id, name: 'Tried', sort_order: 1 },
  ],
  custom_list_items: [
    { id: 'I1', list_id: 'L1', user_id: USER.id, name: 'Rioja', status_id: 'S2', rating: 8, type_ids: ['T1'], created_at: '2026-01-05T00:00:00Z' },
    { id: 'I2', list_id: 'L1', user_id: USER.id, name: 'Barolo', status_id: 'S1', rating: null, type_ids: [], created_at: '2026-01-06T00:00:00Z' },
  ],
  custom_list_item_images: [{ id: 'P1', item_id: 'I1', user_id: USER.id, image_url: 'demo/rioja.svg', created_at: '2026-01-05T00:00:00Z' }],
  custom_list_types: [],
  restaurants: [],
});

describe('demo backend (PostgREST subset)', () => {
  it('select with filters and order', async () => {
    const { client } = setup(seed());
    const { data, error } = await client.from('custom_lists').select('*').eq('user_id', USER.id).order('created_at', { ascending: false });
    expect(error).toBeNull();
    expect(data!.map((r) => r.id)).toEqual(['L2', 'L1']);
  });

  it('embedded relations, aliases and nulls-last ordering', async () => {
    const { client } = setup(seed());
    const { data } = await client
      .from('custom_list_items')
      .select('*, images:custom_list_item_images(id, image_url), status:custom_list_statuses(id, name, sort_order)')
      .eq('list_id', 'L1')
      .order('rating', { ascending: false, nullsFirst: false });
    expect(data!.map((r) => r.id)).toEqual(['I1', 'I2']);
    expect(data![0].images).toEqual([{ id: 'P1', image_url: 'demo/rioja.svg' }]);
    expect(data![0].status).toEqual({ id: 'S2', name: 'Tried', sort_order: 1 });
    expect(data![1].images).toEqual([]);
  });

  it('single, maybeSingle, in, is, cs, ilike and or filters', async () => {
    const { client } = setup(seed());
    expect((await client.from('custom_lists').select('id').eq('id', 'L1').single()).data).toEqual({ id: 'L1' });
    expect((await client.from('custom_lists').select('id').eq('id', 'nope').maybeSingle()).data).toBeNull();
    expect((await client.from('custom_lists').select('id').eq('id', 'nope').single()).error?.code).toBe('PGRST116');
    expect((await client.from('custom_lists').select('id').in('id', ['L1', 'L3'])).data!.map((r) => r.id)).toEqual(['L1', 'L3']);
    expect((await client.from('custom_list_items').select('id').is('rating', null)).data).toEqual([{ id: 'I2' }]);
    expect((await client.from('custom_list_items').select('id').contains('type_ids', ['T1'])).data).toEqual([{ id: 'I1' }]);
    expect((await client.from('custom_lists').select('id').ilike('name', '%oo%')).data).toEqual([{ id: 'L2' }]);
    expect((await client.from('custom_lists').select('id').or('name.eq.Wines,visibility.eq.private')).data!.map((r) => r.id)).toEqual(['L1', 'L2']);
  });

  it('exact counts with head', async () => {
    const { client } = setup(seed());
    const { count, data } = await client.from('custom_list_items').select('id', { count: 'exact', head: true }).eq('list_id', 'L1');
    expect(count).toBe(2);
    expect(data).toBeNull();
  });

  it('insert applies the real column defaults and returns the row', async () => {
    const { client, db } = setup(seed());
    const { data, error } = await client.from('custom_lists').insert({ user_id: USER.id, name: 'Coffee Beans' }).select().single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ name: 'Coffee Beans', icon: '📋', show_location: true, show_rating: false, rating_mode: 'scale_10', visibility: 'profile' });
    expect(data!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(db.custom_lists).toHaveLength(4);
  });

  it('a duplicate id is refused with 23505, as in Postgres', async () => {
    const { client } = setup(seed());
    const { error } = await client.from('custom_lists').insert({ id: 'L1', user_id: USER.id, name: 'Again' });
    expect(error?.code).toBe('23505');
  });

  it('update and delete with cascades', async () => {
    const { client, db } = setup(seed());
    await client.from('custom_list_items').update({ rating: 9 }).eq('id', 'I1');
    expect(db.custom_list_items.find((r) => r.id === 'I1')!.rating).toBe(9);
    await client.from('custom_list_statuses').delete().eq('id', 'S2');
    expect(db.custom_list_items.find((r) => r.id === 'I1')!.status_id).toBeNull();
    await client.from('custom_lists').delete().eq('id', 'L1');
    expect(db.custom_list_items).toHaveLength(0);
    expect(db.custom_list_item_images).toHaveLength(0);
    expect(db.custom_lists.map((r) => r.id)).toEqual(['L2', 'L3']);
  });

  it('upsert merges on the conflict column', async () => {
    const { client, db } = setup(seed());
    await client.from('custom_lists').upsert({ id: 'L2', user_id: USER.id, name: 'Books 2026' });
    expect(db.custom_lists.find((r) => r.id === 'L2')!.name).toBe('Books 2026');
  });

  it('rpc handlers and unknown rpcs', async () => {
    const { client } = setup(seed());
    expect((await client.rpc('get_shared_preview', { p_kind: 'restaurant', p_id: 'x' })).data).toBeNull();
    expect((await client.rpc('get_explore_lists')).data).toEqual([]);
  });

  it('auth: the demo user is signed in', async () => {
    const { client } = setup(seed());
    const { data } = await client.auth.signInWithPassword({ email: USER.email, password: 'x' });
    expect(data.user?.id).toBe(USER.id);
  });
});
