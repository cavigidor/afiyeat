// Lists V2 - Schema A - regression tests for the three cases the PM reproduced
// (correction checkpoint, 2026-11-15). In-process Postgres only.
//
//   R1  Travel lists are private unless the caller states an audience.
//   R2  A preset key cannot be stored without a valid version (and vice versa).
//   R3  Checklist add: the entry's own id is its identity; a differing outer id
//       is refused; a retry can never store the same entry twice.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture } from './fixture.mjs';

const SCHEMA_A = fs.readFileSync(new URL('../schema_a_proposal.sql', import.meta.url), 'utf8');
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const uuid = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db;
const q = async (sql, params) => (await db.query(sql, params)).rows;
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
const visibility = async (id) => (await q(`SELECT visibility FROM custom_lists WHERE id = $1`, [id]))[0]?.visibility;

let LIST, ITEM;
before(async () => {
  db = await fixture();
  for (const u of [A, B]) {
    await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [u, `${u}@example.test`]);
    if ((await q(`SELECT 1 FROM public.profiles WHERE user_id = $1`, [u])).length === 0) {
      const need = await q(`SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='profiles' AND is_nullable='NO' AND column_default IS NULL AND column_name <> 'user_id'`);
      const cols = ['user_id', ...need.map((c) => c.column_name)];
      const vals = [u, ...need.map((c) => (c.data_type === 'boolean' ? false : `u${u.slice(-1)}`))];
      await db.query(`INSERT INTO public.profiles (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})`, vals);
    }
  }
  await db.exec(SCHEMA_A);
  LIST = uuid(1); ITEM = uuid(2);
  await as(A, async () => {
    await q(`SELECT create_list_from_preset($1, 'Gifts')`, [LIST]);
    const [s] = await q(`SELECT id FROM custom_list_statuses WHERE list_id = $1 ORDER BY sort_order LIMIT 1`, [LIST]);
    await q(`INSERT INTO custom_list_items (id, list_id, user_id, name, status_id) VALUES ($1, $2, $3, 'Shop', $4)`, [ITEM, LIST, A, s.id]);
  });
});

// ---------------------------------------------------------------- R1
test('R1 Travel with the audience omitted is created Only me', async () => {
  await as(A, () => q(`SELECT create_list_from_preset($1, 'Lisbon', 'travel', 1)`, [uuid(10)]));
  assert.equal(await visibility(uuid(10)), 'private');
});
test('R1 Travel with an explicit NULL audience is created Only me', async () => {
  await as(A, () => q(`SELECT create_list_from_preset(p_id => $1, p_name => 'Porto', p_preset_key => 'travel', p_preset_version => 1, p_visibility => NULL)`, [uuid(11)]));
  assert.equal(await visibility(uuid(11)), 'private');
});
test('R1 Travel is shared only when the caller says so explicitly', async () => {
  await as(A, () => q(`SELECT create_list_from_preset(p_id => $1, p_name => 'Rome', p_preset_key => 'travel', p_preset_version => 1, p_visibility => 'profile')`, [uuid(12)]));
  assert.equal(await visibility(uuid(12)), 'profile');
});
test('R1 other presets and plain lists keep today\'s default audience (profile); explicit private is honoured', async () => {
  await as(A, async () => {
    await q(`SELECT create_list_from_preset($1, 'Drinks', 'drinks', 1)`, [uuid(13)]);
    await q(`SELECT create_list_from_preset($1, 'Plain')`, [uuid(14)]);
    await q(`SELECT create_list_from_preset(p_id => $1, p_name => 'Secret', p_visibility => 'private')`, [uuid(15)]);
  });
  assert.equal(await visibility(uuid(13)), 'profile');
  assert.equal(await visibility(uuid(14)), 'profile');
  assert.equal(await visibility(uuid(15)), 'private');
});
test('R1 a Travel list an older client inserts directly, without the function, is also Only me', async () => {
  await as(A, () => q(`INSERT INTO custom_lists (id, user_id, name, preset_key, preset_version) VALUES ($1, $2, 'Direct', 'travel', 1)`, [uuid(16), A]));
  assert.equal(await visibility(uuid(16)), 'private');
  // An insert cannot tell an omitted audience from an explicit one, so every Travel insert starts
  // Only me; sharing is a separate explicit update, which is honoured.
  await as(A, () => q(`INSERT INTO custom_lists (id, user_id, name, preset_key, preset_version, visibility) VALUES ($1, $2, 'Direct shared', 'travel', 1, 'profile')`, [uuid(17), A]));
  assert.equal(await visibility(uuid(17)), 'private');
  await as(A, () => q(`UPDATE custom_lists SET visibility = 'profile' WHERE id = $1`, [uuid(17)]));
  assert.equal(await visibility(uuid(17)), 'profile');
});
test('R1 a stranger cannot read an audience-omitted Travel list or its items', async () => {
  const seen = await as(B, () => q(`SELECT id FROM custom_lists WHERE id = ANY($1::uuid[])`, [[uuid(10), uuid(11), uuid(16)]]));
  assert.equal(seen.length, 0);
});

// ---------------------------------------------------------------- R2
test('R2 a preset key without a version is refused, by the function and by a direct write', async () => {
  await rejects(as(A, () => q(`SELECT create_list_from_preset($1, 'X', 'drinks')`, [uuid(20)])), /preset|22023|23514/);
  await rejects(as(A, () => q(`INSERT INTO custom_lists (id, user_id, name, preset_key) VALUES ($1, $2, 'X', 'drinks')`, [uuid(21), A])), /custom_lists_preset_check|23514/);
  await rejects(as(A, () => q(`UPDATE custom_lists SET preset_version = NULL WHERE id = $1`, [uuid(13)])), /custom_lists_preset_check|23514/);
  assert.equal((await q(`SELECT 1 FROM custom_lists WHERE id = ANY($1::uuid[])`, [[uuid(20), uuid(21)]])).length, 0);
});
test('R2 a version without a key, a zero/negative version and a malformed key are refused', async () => {
  await rejects(as(A, () => q(`SELECT create_list_from_preset($1, 'X', NULL, 1)`, [uuid(22)])), /preset|22023|23514/);
  await rejects(as(A, () => q(`SELECT create_list_from_preset($1, 'X', 'drinks', 0)`, [uuid(23)])), /preset|22023|23514/);
  await rejects(as(A, () => q(`SELECT create_list_from_preset($1, 'X', 'Drinks!', 1)`, [uuid(24)])), /preset|22023|23514/);
  await rejects(as(A, () => q(`INSERT INTO custom_lists (id, user_id, name, preset_version) VALUES ($1, $2, 'X', 1)`, [uuid(25), A])), /custom_lists_preset_check|23514/);
});
test('R2 no stored list has a key without a version', async () => {
  const bad = await q(`SELECT id FROM custom_lists WHERE (preset_key IS NULL) <> (preset_version IS NULL)`);
  assert.equal(bad.length, 0);
});
test('R2 category preset keys on custom_list_types need a valid key when present', async () => {
  await rejects(as(A, () => q(`INSERT INTO custom_list_types (list_id, user_id, name, preset_key) VALUES ($1, $2, 'Bad', 'Not A Key')`, [LIST, A])), /23514|check/);
});

// ---------------------------------------------------------------- R3
const entries = async () => (await q(`SELECT details -> 'wishlist' AS w FROM custom_list_items WHERE id = $1`, [ITEM]))[0].w ?? [];
const add = (op) => as(A, () => q(`SELECT apply_checklist_op($1, 'wishlist', $2::jsonb)`, [ITEM, JSON.stringify(op)]));

test('R3 add with an outer id that differs from entry.id is refused and stores nothing', async () => {
  await rejects(add({ op: 'add', id: 'outer-id-0001', entry: { id: 'entry-id-0001', text: 'Scarf' } }), /22023/);
  assert.deepEqual(await entries(), []);
});
test('R3 add without entry.id is refused, even when an outer id is given', async () => {
  await rejects(add({ op: 'add', id: 'outer-id-0002', entry: { text: 'Scarf' } }), /22023/);
  await rejects(add({ op: 'add', entry: { id: 12345678, text: 'Scarf' } }), /22023/);
  assert.deepEqual(await entries(), []);
});
test('R3 repeating the same add - with or without a matching outer id - stores one entry', async () => {
  const entry = { id: 'entry-id-0003', text: 'Scarf', price: 48, link: null, done: false };
  await add({ op: 'add', entry });
  await add({ op: 'add', entry });
  await add({ op: 'add', id: 'entry-id-0003', entry });
  await add({ op: 'add', entry: { ...entry, text: 'A different text on retry' } });
  const w = await entries();
  assert.equal(w.length, 1);
  assert.deepEqual(w[0], entry);
});
test('R3 an entry is stored from known keys only, with checked types', async () => {
  await rejects(add({ op: 'add', entry: { id: 'entry-id-0004', text: 'Hat', owner: 'someone', extra: 1 } }), /22023/);
  await rejects(add({ op: 'add', entry: { id: 'entry-id-0005', text: 5 } }), /22023/);
  await rejects(add({ op: 'add', entry: { id: 'entry-id-0006', text: 'Hat', done: 'yes' } }), /22023/);
  await rejects(add({ op: 'add', entry: { id: 'entry-id-0007', text: 'Hat', price: 'cheap' } }), /22023/);
  await rejects(add({ op: 'add', entry: { id: 'entry-id-0008', text: '' } }), /22023/);
  assert.equal((await entries()).length, 1);
});
test('R3 set cannot change an entry\'s id, and value types are checked', async () => {
  await rejects(add({ op: 'set', id: 'entry-id-0003', key: 'id', value: 'entry-id-9999' }), /22023/);
  await rejects(add({ op: 'set', id: 'entry-id-0003', key: 'done', value: 'yes' }), /22023/);
  await add({ op: 'set', id: 'entry-id-0003', key: 'done', value: true });
  const w = await entries();
  assert.equal(w.length, 1);
  assert.equal(w[0].id, 'entry-id-0003');
  assert.equal(w[0].done, true);
});
test('R3 no stored checklist holds the same id twice (invariant over every item)', async () => {
  const dup = await q(`
    SELECT i.id, e.key, x.value ->> 'id' AS entry_id, count(*)
      FROM custom_list_items i, jsonb_each(i.details) e, jsonb_array_elements(e.value) x
     WHERE jsonb_typeof(e.value) = 'array' AND jsonb_typeof(x.value) = 'object'
     GROUP BY 1, 2, 3 HAVING count(*) > 1`);
  assert.equal(dup.length, 0);
});
test('R3 a direct write cannot store duplicate or id-less checklist entries either', async () => {
  const dupes = JSON.stringify({ wishlist: [{ id: 'entry-id-0010', text: 'a' }, { id: 'entry-id-0010', text: 'b' }] });
  await rejects(as(A, () => q(`UPDATE custom_list_items SET details = $2::jsonb WHERE id = $1`, [ITEM, dupes])), /23514|details/);
  const noId = JSON.stringify({ wishlist: [{ text: 'a' }] });
  await rejects(as(A, () => q(`UPDATE custom_list_items SET details = $2::jsonb WHERE id = $1`, [ITEM, noId])), /23514|details/);
});
