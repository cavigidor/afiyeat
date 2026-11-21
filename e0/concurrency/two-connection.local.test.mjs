// Lists V2 - Schema A - genuine two-connection concurrency and retry tests.
// Runs against a LOCAL Postgres server (concurrency/start-local-pg.sh): two real backend
// connections, real row locks, real transactions held open. Never connects to Supabase or Lovable.
//
//   ./concurrency/start-local-pg.sh && node --test concurrency/two-connection.local.test.mjs
//
// What this proves: the database-level behaviour of Schema A's functions under overlap.
// What it does not prove: PostgREST/supabase-js behaviour, network timeouts, or Supabase's
// Postgres version and configuration. concurrency/two-connection.isolated.mjs covers those
// against the approved isolated project, and has NOT been run.
import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalDatabase, userConnection, client } from '../lib/localpg.mjs';

const DB = 'e0_concurrency';
const STACK = process.env.E0_STACK_REF ?? 'origin/stack/14-photo-records-owner-check';
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const id = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let admin, c1, c2, LIST, STATUS;

/** Resolves when `pid` is waiting on a lock: proof that the second call really overlapped the first. */
async function waitUntilBlocked(pid) {
  for (let i = 0; i < 200; i++) {
    const { rows } = await admin.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid]);
    if (rows[0]?.wait_event_type === 'Lock') return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('the second connection never waited on the first: the test did not overlap');
}
const pid = async (c) => (await c.query(`SELECT pg_backend_pid() AS p`)).rows[0].p;

before(async () => {
  await buildLocalDatabase({ name: DB, stackRef: STACK, extra: [process.env.E0_SCHEMA_A ?? 'schema/schema_a_proposal.sql', 'schema/schema_a_addendum_owner_check.sql', 'schema/schema_a_my_restaurants_private_fields.sql'] });
  admin = client(DB); await admin.connect();
  for (const u of [A, B]) {
    await admin.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [u, `${u}@example.test`]);
    const { rows } = await admin.query(`SELECT 1 FROM public.profiles WHERE user_id = $1`, [u]);
    if (!rows.length) {
      const need = (await admin.query(`SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='profiles' AND is_nullable='NO' AND column_default IS NULL AND column_name <> 'user_id'`)).rows;
      const cols = ['user_id', ...need.map((c) => c.column_name)];
      await admin.query(`INSERT INTO public.profiles (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})`,
        [u, ...need.map((c) => (c.data_type === 'boolean' ? false : `u${u.slice(-1)}`))]);
    }
  }
  c1 = await userConnection(DB, A);
  c2 = await userConnection(DB, A);
  LIST = id(1);
  await c1.query(`SELECT create_list_from_preset($1, 'Gifts')`, [LIST]);
  STATUS = (await c1.query(`SELECT id FROM custom_list_statuses WHERE list_id = $1 ORDER BY sort_order LIMIT 1`, [LIST])).rows[0].id;
});
// A failed test must not leave a transaction open for the next one.
afterEach(async () => { for (const c of [c1, c2]) await c?.query('ROLLBACK').catch(() => {}); });
after(async () => { for (const c of [c1, c2, admin]) await c?.end(); });

test('C1 the same create_list_from_preset on two connections at once: one list, statuses once, both calls succeed', async () => {
  const L = id(10);
  await c1.query('BEGIN');
  await c1.query(`SELECT create_list_from_preset($1, 'Lisbon', 'travel', 1)`, [L]);
  const p2 = await pid(c2);
  const second = c2.query(`SELECT create_list_from_preset($1, 'Lisbon', 'travel', 1) AS r`, [L]); // waits on c1's row
  await waitUntilBlocked(p2);
  await c1.query('COMMIT');
  assert.equal((await second).rows[0].r, L);
  const { rows } = await admin.query(`SELECT (SELECT count(*) FROM custom_lists WHERE id = $1)::int AS lists,
      (SELECT count(*) FROM custom_list_statuses WHERE list_id = $1)::int AS statuses,
      (SELECT visibility FROM custom_lists WHERE id = $1) AS vis`, [L]);
  assert.deepEqual(rows[0], { lists: 1, statuses: 2, vis: 'private' });
});

test('C2 if the first attempt rolls back (e.g. the app was killed), the waiting retry creates the list', async () => {
  const L = id(11);
  await c1.query('BEGIN');
  await c1.query(`SELECT create_list_from_preset($1, 'Porto')`, [L]);
  const p2 = await pid(c2);
  const second = c2.query(`SELECT create_list_from_preset($1, 'Porto') AS r`, [L]);
  await waitUntilBlocked(p2);
  await c1.query('ROLLBACK');
  assert.equal((await second).rows[0].r, L);
  const { rows } = await admin.query(`SELECT count(*)::int AS n FROM custom_list_statuses WHERE list_id = $1`, [L]);
  assert.equal(rows[0].n, 2);
});

test('C3 another user racing for the same list id gets "already in use" and creates nothing', async () => {
  const L = id(12);
  const cb = await userConnection(DB, B);
  try {
    await c1.query('BEGIN');
    await c1.query(`SELECT create_list_from_preset($1, 'Mine')`, [L]);
    const pb = await pid(cb);
    const theirs = cb.query(`SELECT create_list_from_preset($1, 'Theirs')`, [L]).then(() => null, (e) => e);
    await waitUntilBlocked(pb);
    await c1.query('COMMIT');
    const err = await theirs;
    assert.ok(err && err.code === '23505', `expected 23505, got ${err?.code}`);
    const { rows } = await admin.query(`SELECT user_id, name FROM custom_lists WHERE id = $1`, [L]);
    assert.deepEqual(rows, [{ user_id: A, name: 'Mine' }]);
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM custom_list_statuses WHERE list_id = $1 AND user_id = $2`, [L, B])).rows[0].n, 0);
  } finally { await cb.end(); }
});

async function newItem(n, details = '{}') {
  const I = id(n);
  await c1.query(`INSERT INTO custom_list_items (id, list_id, user_id, name, status_id, details) VALUES ($1, $2, $3, 'Shop', $4, $5::jsonb)`, [I, LIST, A, STATUS, details]);
  return I;
}
const op = (c, item, o) => c.query(`SELECT apply_checklist_op($1, 'wishlist', $2::jsonb) AS w`, [item, JSON.stringify(o)]);
const wishlist = async (item) => (await admin.query(`SELECT details FROM custom_list_items WHERE id = $1`, [item])).rows[0].details.wishlist ?? [];

test('C4 two devices add different entries at the same moment: both survive, neither overwrites the other', async () => {
  const I = await newItem(20, '{"brands":["Lamy"]}');
  await c1.query('BEGIN');
  await op(c1, I, { op: 'add', entry: { id: 'phone-00001', text: 'Atlas' } });
  const p2 = await pid(c2);
  const second = op(c2, I, { op: 'add', entry: { id: 'laptop-0001', text: 'Ink' } });
  await waitUntilBlocked(p2);
  await c1.query('COMMIT');
  await second;
  assert.deepEqual((await wishlist(I)).map((e) => e.id), ['phone-00001', 'laptop-0001']);
  const { rows } = await admin.query(`SELECT details -> 'brands' AS b FROM custom_list_items WHERE id = $1`, [I]);
  assert.deepEqual(rows[0].b, ['Lamy']);
});

test('C5 the same add sent twice at once (a retry racing the original): stored once', async () => {
  const I = await newItem(21);
  const entry = { id: 'retry-00001', text: 'Scarf', price: 48 };
  await c1.query('BEGIN');
  await op(c1, I, { op: 'add', entry });
  const p2 = await pid(c2);
  const second = op(c2, I, { op: 'add', id: 'retry-00001', entry });
  await waitUntilBlocked(p2);
  await c1.query('COMMIT');
  await second;
  assert.deepEqual((await wishlist(I)).map((e) => e.id), ['retry-00001']);
});

test('C6 a retry whose outer id differs from entry.id is refused even under overlap', async () => {
  const I = await newItem(22);
  await c1.query('BEGIN');
  await op(c1, I, { op: 'add', entry: { id: 'entry-00001', text: 'Hat' } });
  const bad = await op(c2, I, { op: 'add', id: 'other-00001', entry: { id: 'entry-00002', text: 'Hat' } }).then(() => null, (e) => e);
  await c1.query('COMMIT');
  assert.equal(bad?.code, '22023'); // refused before it takes the row lock, so it does not wait
  assert.deepEqual((await wishlist(I)).map((e) => e.id), ['entry-00001']);
});

test('C7 tick on one device while the other removes the same entry: the removal wins, nothing reappears', async () => {
  const I = await newItem(23);
  await op(c1, I, { op: 'add', entry: { id: 'gone-000001', text: 'Pen' } });
  await c1.query('BEGIN');
  await op(c1, I, { op: 'remove', id: 'gone-000001' });
  const p2 = await pid(c2);
  const tick = op(c2, I, { op: 'set', id: 'gone-000001', key: 'done', value: true });
  await waitUntilBlocked(p2);
  await c1.query('COMMIT');
  await tick;
  assert.deepEqual(await wishlist(I), []);
});

test('C8 two devices patch different detail keys at once: both keys survive (no lost update)', async () => {
  const I = await newItem(24, '{"origin":"Kenya"}');
  await c1.query('BEGIN');
  await c1.query(`SELECT patch_item_details($1, '{"roaster":"Tide"}')`, [I]);
  const p2 = await pid(c2);
  const second = c2.query(`SELECT patch_item_details($1, '{"process":"Washed"}')`, [I]);
  await waitUntilBlocked(p2);
  await c1.query('COMMIT');
  await second;
  const { rows } = await admin.query(`SELECT details FROM custom_list_items WHERE id = $1`, [I]);
  assert.deepEqual(rows[0].details, { origin: 'Kenya', roaster: 'Tide', process: 'Washed' });
});

test('C9 two devices customise the same list at once: both overrides survive', async () => {
  await c1.query('BEGIN');
  await c1.query(`SELECT patch_list_config($1, '[{"path":["fields","price","hidden"],"value":true}]')`, [LIST]);
  const p2 = await pid(c2);
  const second = c2.query(`SELECT patch_list_config($1, '[{"path":["fields","notes","label"],"value":"Why"}]')`, [LIST]);
  await waitUntilBlocked(p2);
  await c1.query('COMMIT');
  await second;
  const { rows } = await admin.query(`SELECT config FROM custom_lists WHERE id = $1`, [LIST]);
  assert.deepEqual(rows[0].config.fields, { price: { hidden: true }, notes: { label: 'Why' } });
});

test('C10 an item insert retried with the same client id on a second connection: one row; the retry sees 23505', async () => {
  const I = id(30);
  const sql = `INSERT INTO custom_list_items (id, list_id, user_id, name, status_id) VALUES ($1, $2, $3, 'Cafe', $4)`;
  await c1.query('BEGIN');
  await c1.query(sql, [I, LIST, A, STATUS]);
  const p2 = await pid(c2);
  const retry = c2.query(sql, [I, LIST, A, STATUS]).then(() => null, (e) => e);
  await waitUntilBlocked(p2);
  await c1.query('COMMIT');
  assert.equal((await retry)?.code, '23505');
  assert.equal((await admin.query(`SELECT count(*)::int AS n FROM custom_list_items WHERE id = $1`, [I])).rows[0].n, 1);
  // Client contract: a 23505 on an id this device generated means "already saved", confirmed by re-reading the row.
  assert.equal((await c2.query(`SELECT count(*)::int AS n FROM custom_list_items WHERE id = $1`, [I])).rows[0].n, 1);
});

test('C11 a custom-field delete and a value write for that field at the same moment: never a value without a definition', async () => {
  const R = id(40);
  await c1.query(`INSERT INTO restaurants (id, user_id, name) VALUES ($1, $2, 'Race place')`, [R, A]);
  await c1.query(`SELECT patch_restaurants_config('[{"path":["custom_fields","c_race","label"],"value":"Race"}]')`);
  await c1.query(`SELECT patch_restaurant_private_details($1, '{"c_race":"first"}')`, [R]);
  // Delete holds the settings row; the write must wait for it, then find the field gone.
  await c1.query('BEGIN');
  await c1.query(`SELECT delete_restaurant_custom_field('c_race', 1)`);
  const p2 = await pid(c2);
  const write = c2.query(`SELECT patch_restaurant_private_details($1, '{"c_race":"second"}')`, [R]).then(() => null, (e) => e);
  await waitUntilBlocked(p2);
  await c1.query('COMMIT');
  assert.equal((await write)?.code, '22023');
  const { rows } = await admin.query(`SELECT count(*)::int n FROM restaurant_private_details WHERE user_id = $1 AND "values" ? 'c_race'`, [A]);
  assert.equal(rows[0].n, 0);
  // And the other order: a write in progress makes the delete wait, then the count it was given is stale.
  await c1.query(`SELECT patch_restaurants_config('[{"path":["custom_fields","c_race2","label"],"value":"Race 2"}]')`);
  await c1.query('BEGIN');
  await c1.query(`SELECT patch_restaurant_private_details($1, '{"c_race2":"x"}')`, [R]);
  const del = c2.query(`SELECT delete_restaurant_custom_field('c_race2', 0)`).then(() => null, (e) => e);
  await waitUntilBlocked(p2);
  await c1.query('COMMIT');
  assert.equal((await del)?.code, '40001', 'the person confirmed 0 places but 1 now has a value: refused, nothing deleted');
  assert.equal((await admin.query(`SELECT count(*)::int n FROM restaurant_private_details WHERE "values" ? 'c_race2'`)).rows[0].n, 1);
});
