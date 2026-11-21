// Lists V2 - Schema A - security and behaviour tests (PROPOSAL, for review).
//
// Runs entirely inside an in-process Postgres (PGlite). It never connects to
// Supabase, Lovable or any network database.
//
// Fixture: see fixture.mjs (main repaired + the stack's five pending migrations).
//
//   node --test schema_a.test.mjs
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture } from './fixture.mjs';

const SCHEMA_A = fs.readFileSync(new URL('../schema_a_proposal.sql', import.meta.url), 'utf8');
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const uuid = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LEGACY_LIST = uuid(1), LEGACY_ITEM = uuid(2), LEGACY_STATUS = uuid(3), LEGACY_REST = uuid(4);

let db;
const q = async (sql, params) => (await db.query(sql, params)).rows;

/** Run statements as a signed-in user, with row-level security in force. */
async function as(uid, fn) {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await fn(); } finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`); }
}
const rejects = async (promise, pattern) => {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  assert.ok(err, 'expected the statement to be refused');
  if (pattern) assert.match(String(err.message) + ' ' + String(err.code), pattern);
  return err;
};

before(async () => {
  db = await fixture();
  // Two accounts with public profiles.
  for (const u of [A, B]) {
    await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [u, `${u}@example.test`]);
    if ((await q(`SELECT 1 FROM public.profiles WHERE user_id = $1`, [u])).length === 0) {
      const need = await q(`SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='profiles' AND is_nullable='NO' AND column_default IS NULL AND column_name <> 'user_id'`);
      const cols = ['user_id', ...need.map((c) => c.column_name)];
      const vals = [u, ...need.map((c) => (c.data_type === 'boolean' ? false : `u${u.slice(-1)}`))];
      await db.query(`INSERT INTO public.profiles (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})`, vals);
    }
    await db.query(`UPDATE public.profiles SET is_private = false WHERE user_id = $1`, [u]);
  }
  // Rows that exist BEFORE Schema A, written the way today's app writes them.
  await db.query(`INSERT INTO public.custom_lists (id, user_id, name, show_notes) VALUES ($1, $2, 'Old list', true)`, [LEGACY_LIST, A]);
  await db.query(`INSERT INTO public.custom_list_statuses (id, list_id, user_id, name, sort_order) VALUES ($1, $2, $3, 'To Do', 0)`, [LEGACY_STATUS, LEGACY_LIST, A]);
  await db.query(`INSERT INTO public.custom_list_items (id, list_id, user_id, name, notes, status_id) VALUES ($1, $2, $3, 'Old item', 'old note', $4)`, [LEGACY_ITEM, LEGACY_LIST, A, LEGACY_STATUS]);
  await db.query(`INSERT INTO public.restaurants (id, user_id, name) VALUES ($1, $2, 'Old place')`, [LEGACY_REST, A]);
  await db.exec(SCHEMA_A);
});

test('applies cleanly and can be applied a second time', async () => {
  await db.exec(SCHEMA_A);
});

test('existing rows are valid and untouched; new columns take their defaults', async () => {
  const [l] = await q(`SELECT name, preset_key, preset_version, config FROM custom_lists WHERE id = $1`, [LEGACY_LIST]);
  assert.deepEqual(l, { name: 'Old list', preset_key: null, preset_version: null, config: {} });
  const [i] = await q(`SELECT name, notes, details, is_favorite FROM custom_list_items WHERE id = $1`, [LEGACY_ITEM]);
  assert.deepEqual(i, { name: 'Old item', notes: 'old note', details: {}, is_favorite: false });
  const [r] = await q(`SELECT details FROM restaurants WHERE id = $1`, [LEGACY_REST]);
  assert.deepEqual(r.details, {});
});

test('an older client keeps working and cannot erase new data', async () => {
  await as(A, async () => {
    await q(`SELECT patch_item_details($1, '{"roaster":"Tide"}')`, [LEGACY_ITEM]);
    await q(`SELECT patch_list_config($1, '[{"path":["fields","notes","hidden"],"value":true}]')`, [LEGACY_LIST]);
    // What today's build sends: only the columns it knows.
    await q(`UPDATE custom_list_items SET name = 'Renamed', notes = NULL WHERE id = $1`, [LEGACY_ITEM]);
    await q(`UPDATE custom_lists SET show_notes = false, name = 'Old list 2' WHERE id = $1`, [LEGACY_LIST]);
    await q(`INSERT INTO custom_list_items (list_id, user_id, name, status_id) VALUES ($1, $2, 'From old client', $3)`, [LEGACY_LIST, A, LEGACY_STATUS]);
  });
  const [i] = await q(`SELECT details FROM custom_list_items WHERE id = $1`, [LEGACY_ITEM]);
  assert.deepEqual(i.details, { roaster: 'Tide' });
  const [l] = await q(`SELECT config FROM custom_lists WHERE id = $1`, [LEGACY_LIST]);
  assert.deepEqual(l.config, { fields: { notes: { hidden: true } } });
});

test('create_list_from_preset: list, statuses and categories arrive together', async () => {
  const id = uuid(10);
  await as(A, () => q(`SELECT create_list_from_preset($1, 'Drinks', 'drinks', 1, NULL,
    '{"show_location":false,"show_rating":true,"price_mode":"manual"}',
    '["Want to Try","Tried"]',
    '[{"key":"beer","name":"Beer"},{"key":"wine","name":"Wine","color":"#6B3A80"}]')`, [id]));
  const [l] = await q(`SELECT user_id, name, preset_key, preset_version, show_location, show_rating, price_mode, visibility FROM custom_lists WHERE id = $1`, [id]);
  assert.deepEqual(l, { user_id: A, name: 'Drinks', preset_key: 'drinks', preset_version: 1, show_location: false, show_rating: true, price_mode: 'manual', visibility: 'profile' });
  assert.deepEqual((await q(`SELECT name FROM custom_list_statuses WHERE list_id = $1 ORDER BY sort_order`, [id])).map((r) => r.name), ['Want to Try', 'Tried']);
  assert.deepEqual((await q(`SELECT preset_key FROM custom_list_types WHERE list_id = $1 ORDER BY sort_order`, [id])).map((r) => r.preset_key), ['beer', 'wine']);
});

test('create_list_from_preset: a retry with the same id creates nothing twice', async () => {
  const id = uuid(11);
  for (let n = 0; n < 3; n++) await as(A, () => q(`SELECT create_list_from_preset($1, 'Travel', 'travel', 1, NULL, '{}', '["Planned","Visited"]', '[]', 'private')`, [id]));
  assert.equal((await q(`SELECT count(*)::int n FROM custom_lists WHERE id = $1`, [id]))[0].n, 1);
  assert.equal((await q(`SELECT count(*)::int n FROM custom_list_statuses WHERE list_id = $1`, [id]))[0].n, 2);
});

test('create_list_from_preset: any failure leaves no half-made list', async () => {
  const id = uuid(12);
  // Two categories with the same preset key violate the unique index on the last insert.
  await rejects(as(A, () => q(`SELECT create_list_from_preset($1, 'Broken', 'drinks', 1, NULL, '{}', '["A"]', '[{"key":"wine","name":"Wine"},{"key":"wine","name":"Wine again"}]')`, [id])));
  assert.equal((await q(`SELECT count(*)::int n FROM custom_lists WHERE id = $1`, [id]))[0].n, 0);
  assert.equal((await q(`SELECT count(*)::int n FROM custom_list_statuses WHERE list_id = $1`, [id]))[0].n, 0);
  // A list can never be created without a status.
  await rejects(as(A, () => q(`SELECT create_list_from_preset($1, 'No status', NULL, NULL, NULL, '{}', '[]')`, [uuid(13)])), /statuses/);
  assert.equal((await q(`SELECT count(*)::int n FROM custom_lists WHERE id = $1`, [uuid(13)]))[0].n, 0);
});

test('create_list_from_preset: signed-out, foreign ids and anonymous visibility are refused', async () => {
  await rejects(as(null, () => q(`SELECT create_list_from_preset($1, 'X')`, [uuid(14)])), /not signed in|42501/);
  await rejects(as(B, () => q(`SELECT create_list_from_preset($1, 'Hijack')`, [uuid(10)])), /already in use|23505/);
  assert.equal((await q(`SELECT name FROM custom_lists WHERE id = $1`, [uuid(10)]))[0].name, 'Drinks');
  await rejects(as(A, () => q(`SELECT create_list_from_preset($1, 'Anon', NULL, NULL, NULL, '{}', '["A"]', '[]', 'anonymous')`, [uuid(15)])), /visibility/);
});

test('patch_item_details merges, removes and never touches unnamed keys', async () => {
  const item = uuid(20);
  await as(A, async () => {
    await q(`INSERT INTO custom_list_items (id, list_id, user_id, name, status_id) VALUES ($1, $2, $3, 'Barolo', $4)`, [item, LEGACY_LIST, A, LEGACY_STATUS]);
    await q(`SELECT patch_item_details($1, '{"vintage":2019,"grape":["Nebbiolo"]}')`, [item]);
    await q(`SELECT patch_item_details($1, '{"region":"Piedmont"}')`, [item]);          // device 1
    await q(`SELECT patch_item_details($1, '{"abv":14.5}', ARRAY['vintage'])`, [item]);  // device 2
  });
  assert.deepEqual((await q(`SELECT details FROM custom_list_items WHERE id = $1`, [item]))[0].details, { grape: ['Nebbiolo'], region: 'Piedmont', abv: 14.5 });
});

test('details: structural limits are enforced by the database, on every write path', async () => {
  const item = uuid(20);
  const bad = {
    'too many keys': Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`k${i}`, 1])),
    'long string': { notes2: 'x'.repeat(2001) },
    'nested object': { a: { b: 1 } },
    'long array': { tags: Array.from({ length: 51 }, () => 'x') },
    'bad key': { 'Bad Key': 1 },
    'deep entry': { wishlist: [{ id: 'abcdefgh', more: { x: 1 } }] },
    'long tag': { tags: ['x'.repeat(201)] },
  };
  for (const [name, value] of Object.entries(bad)) {
    await rejects(as(A, () => q(`SELECT patch_item_details($1, $2::jsonb)`, [item, JSON.stringify(value)])), /details_check|23514/).catch((e) => { throw new Error(name + ': ' + e.message); });
    // A client that skips the function and writes the column directly hits the same wall.
    await rejects(as(A, () => q(`UPDATE custom_list_items SET details = $2::jsonb WHERE id = $1`, [item, JSON.stringify(value)])), /details_check|23514/);
  }
  await rejects(as(A, () => q(`UPDATE custom_list_items SET details = '[]'::jsonb WHERE id = $1`, [item])), /details_check|23514/);
  await rejects(as(A, () => q(`UPDATE restaurants SET details = '{"a":{"b":1}}'::jsonb WHERE id = $1`, [LEGACY_REST])), /details_check|23514/);
});

test('cross-user: nobody can patch, configure or tick another user\'s data', async () => {
  const item = uuid(20);
  await rejects(as(B, () => q(`SELECT patch_item_details($1, '{"x":1}')`, [item])), /not yours|42501/);
  await rejects(as(B, () => q(`SELECT patch_list_config($1, '[{"path":["x"],"value":1}]')`, [LEGACY_LIST])), /not yours|42501/);
  await rejects(as(B, () => q(`SELECT patch_restaurant_details($1, '{"x":1}')`, [LEGACY_REST])), /not yours|42501/);
  await rejects(as(B, () => q(`SELECT apply_checklist_op($1, 'wishlist', '{"op":"add","entry":{"id":"entry-0001","text":"x"}}')`, [item])), /not yours|42501/);
  // Direct writes are stopped by the existing policies too (0 rows changed).
  await as(B, () => q(`UPDATE custom_list_items SET details = '{"x":1}' WHERE id = $1`, [item]));
  assert.equal((await q(`SELECT details ? 'x' AS has FROM custom_list_items WHERE id = $1`, [item]))[0].has, false);
  for (const fn of ['create_list_from_preset(uuid,text,text,integer,text,jsonb,jsonb,jsonb,text)', 'patch_item_details(uuid,jsonb,text[])', 'apply_checklist_op(uuid,text,jsonb)', 'patch_list_config(uuid,jsonb,integer)', 'patch_restaurants_config(jsonb)', 'patch_restaurant_details(uuid,jsonb,text[])']) {
    const [p] = await q(`SELECT has_function_privilege('anon', 'public.${fn}', 'EXECUTE') AS anon, prosecdef FROM pg_proc WHERE oid = 'public.${fn}'::regprocedure`);
    assert.deepEqual(p, { anon: false, prosecdef: false }, fn);
  }
});

test('wishlist: operations from two devices both survive; retries do not duplicate', async () => {
  const item = uuid(21);
  const op = (o) => as(A, () => q(`SELECT apply_checklist_op($1, 'wishlist', $2::jsonb) AS w`, [item, JSON.stringify(o)]));
  await as(A, () => q(`INSERT INTO custom_list_items (id, list_id, user_id, name, status_id, details) VALUES ($1, $2, $3, 'Paper Lantern Books', $4, '{"brands":["Lamy"]}')`, [item, LEGACY_LIST, A, LEGACY_STATUS]));
  await op({ op: 'add', entry: { id: 'phone-0001', text: 'Atlas', price: 48, done: false } });   // phone
  await op({ op: 'add', entry: { id: 'laptop-001', text: 'Notebooks', price: 15, done: false } }); // laptop, built on a stale copy
  await op({ op: 'add', entry: { id: 'phone-0001', text: 'Atlas', price: 48, done: false } });   // phone retries after a timeout
  await op({ op: 'set', id: 'laptop-001', key: 'done', value: true });
  await op({ op: 'set', id: 'gone-00001', key: 'done', value: true });                            // entry removed elsewhere: no-op
  await op({ op: 'add', entry: { id: 'phone-0002', text: 'Ink' } });
  await op({ op: 'move', id: 'phone-0002', before: 'phone-0001' });
  let [row] = await q(`SELECT details FROM custom_list_items WHERE id = $1`, [item]);
  assert.deepEqual(row.details.wishlist.map((e) => [e.id, e.done ?? null]), [['phone-0002', false], ['phone-0001', false], ['laptop-001', true]]); // entries are stored normalized: done defaults to false
  assert.deepEqual(row.details.brands, ['Lamy'], 'other detail keys are untouched');
  await op({ op: 'remove', id: 'phone-0001' });
  [row] = await q(`SELECT details FROM custom_list_items WHERE id = $1`, [item]);
  assert.deepEqual(row.details.wishlist.map((e) => e.id), ['phone-0002', 'laptop-001']);
  await rejects(op({ op: 'set', id: 'phone-0002', key: 'id', value: 'x' }), /set needs key/);
  await rejects(op({ op: 'explode', id: 'phone-0002' }), /unknown operation/);
});

test('wishlist: the 50-entry cap is enforced in the database', async () => {
  const item = uuid(22);
  await as(A, async () => {
    await q(`INSERT INTO custom_list_items (id, list_id, user_id, name, status_id) VALUES ($1, $2, $3, 'Full', $4)`, [item, LEGACY_LIST, A, LEGACY_STATUS]);
    for (let n = 0; n < 50; n++) await q(`SELECT apply_checklist_op($1, 'wishlist', $2::jsonb)`, [item, JSON.stringify({ op: 'add', entry: { id: `entry-${String(n).padStart(4, '0')}`, text: 't' } })]);
  });
  await rejects(as(A, () => q(`SELECT apply_checklist_op($1, 'wishlist', '{"op":"add","entry":{"id":"entry-9999","text":"t"}}')`, [item])), /full|23514/);
});

test('patch_list_config: unrelated overrides survive; preset version only moves forward', async () => {
  const id = uuid(10);
  const cfg = (ops, v = null) => as(A, () => q(`SELECT patch_list_config($1, $2::jsonb, $3) AS c`, [id, JSON.stringify(ops), v]));
  await cfg([{ path: ['fields', 'abv', 'hidden'], value: true }, { path: ['fields', 'abv', 'label'], value: 'Strength' }]);
  await cfg([{ path: ['views', 'default'], value: 'list' }], 3);                 // newer client
  await cfg([{ path: ['fields', 'colour', 'hidden'], value: true }], 2);          // older client, later
  await cfg([{ path: ['fields', 'abv', 'label'] }]);                               // remove one override
  const [l] = await q(`SELECT config, preset_version FROM custom_lists WHERE id = $1`, [id]);
  assert.deepEqual(l.config, { fields: { abv: { hidden: true }, colour: { hidden: true } }, views: { default: 'list' } });
  assert.equal(l.preset_version, 3);
  await rejects(cfg([{ path: ['a', 'b', 'c', 'd', 'e'], value: 1 }]), /1 to 4 segments/);
  // A list with no preset never acquires a version.
  await as(A, () => q(`SELECT patch_list_config($1, '[{"path":["views","default"],"value":"list"}]', 5)`, [LEGACY_LIST]));
  assert.equal((await q(`SELECT preset_version FROM custom_lists WHERE id = $1`, [LEGACY_LIST]))[0].preset_version, null);
});

test('My Restaurants settings: created on first use, merged afterwards, private to the owner', async () => {
  await as(A, () => q(`SELECT patch_restaurants_config('[{"path":["fields","dishes","hidden"],"value":true}]')`));
  await as(A, () => q(`SELECT patch_restaurants_config('[{"path":["labels","to_go"],"value":"Wishlist"}]')`));
  assert.deepEqual((await q(`SELECT restaurants_config FROM user_list_settings WHERE user_id = $1`, [A]))[0].restaurants_config, { fields: { dishes: { hidden: true } }, labels: { to_go: 'Wishlist' } });
  assert.equal((await as(B, () => q(`SELECT * FROM user_list_settings WHERE user_id = $1`, [A]))).length, 0);
  await as(B, () => q(`UPDATE user_list_settings SET restaurants_config = '{}' WHERE user_id = $1`, [A]));
  await rejects(as(B, () => q(`INSERT INTO user_list_settings (user_id) VALUES ($1)`, [A])));
  assert.equal(Object.keys((await q(`SELECT restaurants_config FROM user_list_settings WHERE user_id = $1`, [A]))[0].restaurants_config).length, 2);
  await as(A, () => q(`SELECT patch_restaurant_details($1, '{"dishes":["Cacio e pepe"]}')`, [LEGACY_REST]));
  assert.deepEqual((await q(`SELECT details FROM restaurants WHERE id = $1`, [LEGACY_REST]))[0].details, { dishes: ['Cacio e pepe'] });
});

test('who can read details: followers/public yes on a profile list, nobody on Only me', async () => {
  const pub = uuid(10), priv = uuid(11);
  await as(A, async () => {
    const [s1] = await q(`SELECT id FROM custom_list_statuses WHERE list_id = $1 LIMIT 1`, [pub]);
    const [s2] = await q(`SELECT id FROM custom_list_statuses WHERE list_id = $1 LIMIT 1`, [priv]);
    await q(`INSERT INTO custom_list_items (id, list_id, user_id, name, status_id, details) VALUES ($1, $2, $3, 'Public item', $4, '{"price_paid":40}')`, [uuid(30), pub, A, s1.id]);
    await q(`INSERT INTO custom_list_items (id, list_id, user_id, name, status_id, details) VALUES ($1, $2, $3, 'Kyoto', $4, '{"visit_from":"2026-04-03"}')`, [uuid(31), priv, A, s2.id]);
  });
  // Documented, not hidden: a reader of a profile-visible list reads details with the row.
  assert.deepEqual((await as(B, () => q(`SELECT details FROM custom_list_items WHERE id = $1`, [uuid(30)])))[0]?.details, { price_paid: 40 });
  assert.equal((await as(B, () => q(`SELECT id FROM custom_list_items WHERE list_id = $1`, [priv]))).length, 0);
  assert.equal((await as(B, () => q(`SELECT id FROM custom_lists WHERE id = $1`, [priv]))).length, 0);
});

test('anonymous discovery exposes nothing new (D6), by projection and by authorization', async () => {
  const id = uuid(40);
  await as(A, async () => {
    await q(`SELECT create_list_from_preset($1, 'Anon coffee', 'coffee_beans', 1, NULL, '{"show_rating":true}', '["Have"]', '[{"key":"x","name":"X"}]')`, [id]);
    const [s] = await q(`SELECT id FROM custom_list_statuses WHERE list_id = $1`, [id]);
    await q(`INSERT INTO custom_list_items (id, list_id, user_id, name, status_id, rating, notes, details, is_favorite) VALUES ($1, $2, $3, 'Halo Beriti', $4, 9, 'secret note', '{"roaster":"SECRET-ROASTER","wishlist":[{"id":"entry-0001","text":"SECRET-ENTRY"}]}', true)`, [uuid(41), id, A, s.id]);
    await q(`SELECT patch_list_config($1, '[{"path":["custom","note"],"value":"SECRET-CONFIG"}]')`, [id]);
    await q(`UPDATE custom_lists SET visibility = 'anonymous' WHERE id = $1`, [id]);
  });
  const [{ discovery_token: token }] = await q(`SELECT discovery_token FROM custom_lists WHERE id = $1`, [id]);
  // Authorization: another user gets no rows from the tables.
  assert.equal((await as(B, () => q(`SELECT id FROM custom_lists WHERE id = $1`, [id]))).length, 0);
  assert.equal((await as(B, () => q(`SELECT id FROM custom_list_items WHERE list_id = $1`, [id]))).length, 0);
  // Projection: the anonymous view has exactly the keys it had before Schema A.
  const [{ v }] = await as(B, () => q(`SELECT get_discoverable_list($1) AS v`, [token]));
  assert.deepEqual(Object.keys(v).sort(), ['icon', 'is_owner', 'items', 'rating_mode', 'statuses', 'title', 'token', 'types']);
  assert.deepEqual(Object.keys(v.items[0]).sort(), ['name', 'rating', 'status', 'types']);
  const text = JSON.stringify(v);
  for (const secret of ['SECRET', 'details', 'config', 'is_favorite', 'wishlist', 'preset']) assert.ok(!text.includes(secret), `anonymous view leaks ${secret}`);
  // The owner's preview is the same projection.
  const [{ p }] = await as(A, () => q(`SELECT get_list_discovery_preview($1) AS p`, [id]));
  assert.ok(!JSON.stringify(p).includes('SECRET'));
  // Discovery search returns no new columns.
  const cols = (await q(`SELECT pg_get_function_result(oid) r FROM pg_proc WHERE proname = 'get_explore_lists' AND pronamespace = 'public'::regnamespace`))[0].r;
  for (const c of ['details', 'config', 'is_favorite', 'preset']) assert.ok(!cols.includes(c), `get_explore_lists returns ${c}`);
});

test('client-chosen ids make an item insert safe to retry', async () => {
  const id = uuid(50);
  const insert = (uid) => as(uid, () => q(`INSERT INTO custom_list_items (id, list_id, user_id, name, status_id) VALUES ($1, $2, $3, 'Retry me', $4) ON CONFLICT (id) DO NOTHING RETURNING id`, [id, LEGACY_LIST, uid, LEGACY_STATUS]));
  assert.equal((await insert(A)).length, 1);
  assert.equal((await insert(A)).length, 0, 'the retry inserts nothing');
  assert.equal((await q(`SELECT count(*)::int n FROM custom_list_items WHERE id = $1`, [id]))[0].n, 1);
  // The app then confirms by id that the row is its own.
  assert.equal((await as(A, () => q(`SELECT user_id FROM custom_list_items WHERE id = $1`, [id])))[0].user_id, A);
  // Another user cannot claim, overwrite or use that id.
  await rejects(insert(B));
  assert.equal((await q(`SELECT user_id FROM custom_list_items WHERE id = $1`, [id]))[0].user_id, A);
});
