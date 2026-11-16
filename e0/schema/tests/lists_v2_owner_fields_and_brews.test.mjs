// Lists V2 - owner-only custom fields, layout and brew records (PROPOSAL LV2-DB-1/2). In-process Postgres only.
// Applied on the current baseline (main + integration stack), without Schema A.
// Readers: owner, accepted follower who can view the list, stranger, signed-out caller.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture } from './fixture.mjs';

const SQL = fs.readFileSync(new URL('../lists_v2_owner_fields_and_brews.sql', import.meta.url), 'utf8');
const ROLLBACK = fs.readFileSync(new URL('../lists_v2_owner_fields_and_brews_rollback.sql', import.meta.url), 'utf8');
const id = (n) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = id(1), FOLLOWER = id(2), STRANGER = id(3);
const L_BEANS = id(21), L_OTHER = id(22), L_STRANGER = id(23);
const I_KENYA = id(31), I_PERU = id(32), I_OTHER = id(33), I_STRANGER = id(34);
const NEW_TABLES = ['custom_list_owner_settings', 'custom_list_item_owner_values', 'custom_list_item_brews'];
const EXISTING = ['custom_lists', 'custom_list_items', 'custom_list_statuses', 'custom_list_types', 'custom_list_item_images', 'shared_lists', 'shared_list_items', 'restaurants'];

let db;
let beforeShape;
const q = async (sql, p) => (await db.query(sql, p)).rows;
async function as(uid, fn) {
  if (uid) await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false);`);
  else await db.exec(`SET ROLE anon; SELECT set_config('request.jwt.claim.sub', '', false);`);
  try { return await fn(); } finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`); }
}
const rejects = async (promise, pattern) => {
  let err = null; try { await promise; } catch (e) { err = e; }
  assert.ok(err, 'expected the statement to be refused');
  if (pattern) assert.match(String(err.message) + ' ' + String(err.code), pattern);
};
const read = async (who, sql, p) => { try { return await as(who, () => q(sql, p)); } catch { return 'refused'; } };
const shape = () => q(`SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY table_name, column_name`, [EXISTING]);
const policies = () => q(`SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1) ORDER BY 1, 2`, [EXISTING]);
let beforePolicies;

const FIELDS = [
  { key: 'c_origin', label: 'Origin', type: 'text' },
  { key: 'c_altitude', label: 'Altitude (m)', type: 'number' },
  { key: 'c_roasted', label: 'Roasted on', type: 'date' },
  { key: 'c_notes', label: 'Tasting notes', type: 'tags' },
  { key: 'c_process', label: 'Process', type: 'choice', options: ['Washed', 'Natural', 'Honey'] },
];
const setFields = (who, list, fields, layout = {}) => as(who, () => q(
  `INSERT INTO custom_list_owner_settings (list_id, user_id, fields, layout) VALUES ($1, $2, $3, $4)
   ON CONFLICT (list_id) DO UPDATE SET fields = EXCLUDED.fields, layout = EXCLUDED.layout`,
  [list, who, JSON.stringify(fields), JSON.stringify(layout)]));
const setValues = (who, item, list, values) => as(who, () => q(
  `INSERT INTO custom_list_item_owner_values (item_id, list_id, user_id, "values") VALUES ($1, $2, $3, $4)
   ON CONFLICT (item_id) DO UPDATE SET "values" = EXCLUDED."values"`, [item, list, who, JSON.stringify(values)]));
const valuesOf = async (item) => (await q(`SELECT "values" FROM custom_list_item_owner_values WHERE item_id = $1`, [item]))[0]?.values;

before(async () => {
  db = await fixture();
  for (const u of [OWNER, FOLLOWER, STRANGER]) {
    await q(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [u, `${u}@example.test`]);
    if ((await q(`SELECT 1 FROM public.profiles WHERE user_id = $1`, [u])).length === 0) await q(`INSERT INTO public.profiles (user_id, username) VALUES ($1, $2)`, [u, 'q' + u.slice(-2)]);
  }
  await q(`INSERT INTO public.follows (follower_id, following_id) VALUES ($1, $2)`, [FOLLOWER, OWNER]);
  await q(`UPDATE public.follows SET status = 'accepted'`);
  await q(`INSERT INTO public.custom_lists (id, user_id, name, visibility) VALUES ($1, $4, 'Coffee Beans', 'profile'), ($2, $4, 'Other', 'profile'), ($3, $5, 'Theirs', 'profile')`,
    [L_BEANS, L_OTHER, L_STRANGER, OWNER, STRANGER]);
  await q(`INSERT INTO public.custom_list_items (id, list_id, user_id, name) VALUES ($1, $2, $3, 'Kenya AA'), ($4, $2, $3, 'Peru'), ($5, $6, $3, 'Other item'), ($7, $8, $9, 'Their item')`,
    [I_KENYA, L_BEANS, OWNER, I_PERU, I_OTHER, L_OTHER, I_STRANGER, L_STRANGER, STRANGER]);
  beforeShape = await shape();
  beforePolicies = await policies();
  await db.exec(SQL);
});

test('DB-1 applies cleanly on the current baseline (no Schema A) and a second time', async () => {
  await db.exec(SQL);
  for (const t of NEW_TABLES) assert.equal((await q(`SELECT to_regclass($1) AS r`, [`public.${t}`]))[0].r, t);
});

test('DB-2 existing tables, columns and policies are exactly as before', async () => {
  assert.deepEqual(await shape(), beforeShape);
  assert.deepEqual(await policies(), beforePolicies);
});

test('DB-3 the follower can see the list itself, as today', async () => {
  const rows = await read(FOLLOWER, `SELECT name FROM custom_list_items WHERE list_id = $1 ORDER BY name`, [L_BEANS]);
  assert.deepEqual(rows.map((r) => r.name), ['Kenya AA', 'Peru']);
});

test('DB-4 the owner defines fields of every type and saves typed values', async () => {
  await setFields(OWNER, L_BEANS, FIELDS, { field_order: ['rating', 'c_origin', 'price'], view: 'cards', sort: 'rating' });
  await setValues(OWNER, I_KENYA, L_BEANS, { c_origin: 'Nyeri', c_altitude: 1800, c_roasted: '2026-11-02', c_notes: ['blackcurrant', 'tomato'], c_process: 'Washed' });
  assert.deepEqual(await valuesOf(I_KENYA), { c_origin: 'Nyeri', c_altitude: 1800, c_roasted: '2026-11-02', c_notes: ['blackcurrant', 'tomato'], c_process: 'Washed' });
});

test('DB-5 wrong types, undefined keys, bad dates, unknown choices and bad layouts are refused', async () => {
  for (const bad of [{ c_altitude: 'high' }, { c_unknown: 'x' }, { c_roasted: '2026-02-30' }, { c_process: 'Anaerobic' }, { c_notes: [1] }, { origin: 'no prefix' }]) {
    await rejects(setValues(OWNER, I_PERU, L_BEANS, bad), /23514|violates|fit|defined/);
  }
  await rejects(setFields(OWNER, L_OTHER, [{ key: 'c_a', label: 'A', type: 'colour' }]), /check/);
  await rejects(setFields(OWNER, L_OTHER, [{ key: 'c_a', label: 'A', type: 'text' }, { key: 'c_a', label: 'B', type: 'text' }]), /check/);
  await rejects(setFields(OWNER, L_OTHER, [{ key: 'c_a', label: 'A', type: 'choice' }]), /check/);
  await rejects(setFields(OWNER, L_OTHER, [], { view: 'carousel' }), /check/);
});

test('DB-6 values must be on the item\'s own list', async () => {
  await setFields(OWNER, L_OTHER, [{ key: 'c_origin', label: 'Origin', type: 'text' }]);
  await rejects(setValues(OWNER, I_KENYA, L_OTHER, { c_origin: 'x' }), /not on list/);
});

test('DB-7 nobody but the owner reads settings, values or brews: follower, stranger, signed out', async () => {
  await as(OWNER, () => q(`INSERT INTO custom_list_item_brews (item_id, user_id, method, dose_g, water_g, rating) VALUES ($1, $2, 'V60', 15, 250, 8.5)`, [I_KENYA, OWNER]));
  for (const t of NEW_TABLES) {
    assert.ok((await read(OWNER, `SELECT * FROM ${t}`)).length > 0, `owner reads ${t}`);
    for (const who of [FOLLOWER, STRANGER]) assert.deepEqual(await read(who, `SELECT * FROM ${t}`), [], `${who} reads nothing from ${t}`);
    assert.equal(await read(null, `SELECT * FROM ${t}`), 'refused', `signed out: ${t}`);
  }
});

test('DB-8 others cannot write into the owner\'s list, even naming themselves as user', async () => {
  await rejects(setFields(STRANGER, L_BEANS, FIELDS), /row-level security|policy/);
  // Refused either by the policy or, first, by the value check (the stranger cannot see the list's definitions).
  await rejects(setValues(STRANGER, I_PERU, L_BEANS, { c_origin: 'x' }), /row-level security|policy|not defined/);
  await rejects(as(STRANGER, () => q(`INSERT INTO custom_list_item_brews (item_id, user_id) VALUES ($1, $2)`, [I_KENYA, STRANGER])), /row-level security|policy/);
  await rejects(as(FOLLOWER, () => q(`INSERT INTO custom_list_item_brews (item_id, user_id) VALUES ($1, $2)`, [I_KENYA, FOLLOWER])), /row-level security|policy/);
  // ...and cannot change or delete what the owner saved.
  await as(STRANGER, async () => { await q(`UPDATE custom_list_item_owner_values SET "values" = '{}'`); await q(`DELETE FROM custom_list_item_brews`); });
  assert.equal((await valuesOf(I_KENYA)).c_origin, 'Nyeri');
  assert.equal((await q(`SELECT count(*)::int AS n FROM custom_list_item_brews WHERE item_id = $1`, [I_KENYA]))[0].n, 1);
  // The owner cannot attach rows to someone else's list either.
  await rejects(setFields(OWNER, L_STRANGER, []), /row-level security|policy/);
  await rejects(as(OWNER, () => q(`INSERT INTO custom_list_item_brews (item_id, user_id) VALUES ($1, $2)`, [I_STRANGER, OWNER])), /row-level security|policy/);
});

test('DB-9 several brews per item; invalid measurements refused', async () => {
  await as(OWNER, () => q(`INSERT INTO custom_list_item_brews (item_id, user_id, brewed_on, method, grind, water_temp_c, brew_seconds, notes)
    VALUES ($1, $2, '2026-11-03', 'AeroPress', 'Fine', 85, 120, 'Sweeter'), ($1, $2, '2026-11-04', 'Espresso', '2.5', 93, 28, NULL)`, [I_KENYA, OWNER]));
  const rows = await as(OWNER, () => q(`SELECT method FROM custom_list_item_brews WHERE item_id = $1 ORDER BY brewed_on DESC, created_at DESC`, [I_KENYA]));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.method), ['V60', 'Espresso', 'AeroPress'], 'newest brew first (V60 is today)');
  for (const bad of [`dose_g = -1`, `water_temp_c = 120`, `rating = 11`, `brew_seconds = 0`, `method = ''`]) {
    await rejects(as(OWNER, () => q(`UPDATE custom_list_item_brews SET ${bad} WHERE item_id = $1`, [I_KENYA])), /check/);
  }
});

test('DB-10 hiding a field keeps its values (O1)', async () => {
  const hidden = FIELDS.map((f) => (f.key === 'c_origin' ? { ...f, hidden: true } : f));
  await setFields(OWNER, L_BEANS, hidden, { view: 'cards' });
  assert.equal((await valuesOf(I_KENYA)).c_origin, 'Nyeri');
  await setValues(OWNER, I_PERU, L_BEANS, { c_origin: 'Cajamarca' }); // still writable while hidden
});

test('DB-11 a field with values cannot be dropped, retyped or lose an option by a plain update', async () => {
  await rejects(setFields(OWNER, L_BEANS, FIELDS.filter((f) => f.key !== 'c_origin')), /still has saved values/);
  await rejects(setFields(OWNER, L_BEANS, FIELDS.map((f) => (f.key === 'c_altitude' ? { ...f, type: 'text' } : f))), /still has saved values/);
  await rejects(setFields(OWNER, L_BEANS, FIELDS.map((f) => (f.key === 'c_process' ? { ...f, options: ['Natural'] } : f))), /still has saved values/, 'Washed is in use');
  // Renaming the label, adding an option or removing an unused one is fine.
  await setFields(OWNER, L_BEANS, FIELDS.map((f) => (f.key === 'c_process' ? { ...f, label: 'Processing', options: [...f.options, 'Anaerobic'] } : f)));
  await setFields(OWNER, L_BEANS, FIELDS.map((f) => (f.key === 'c_process' ? { ...f, options: ['Washed'] } : f)));
  // A field nobody has filled in can simply be removed.
  await setFields(OWNER, L_BEANS, FIELDS.concat([{ key: 'c_unused', label: 'Unused', type: 'text' }]));
  await setFields(OWNER, L_BEANS, FIELDS);
});

test('DB-12 permanent delete: count first, stale count refused, then values and definition go together', async () => {
  const count = async () => (await as(OWNER, () => q(`SELECT count_custom_list_field_values($1, 'c_origin') AS n`, [L_BEANS])))[0].n;
  assert.equal(await count(), 2);
  await setFields(OWNER, L_BEANS, FIELDS, { field_order: ['c_origin', 'rating'] });
  await rejects(as(OWNER, () => q(`SELECT delete_custom_list_field($1, 'c_origin', 1)`, [L_BEANS])), /count changed/);
  assert.equal((await valuesOf(I_KENYA)).c_origin, 'Nyeri', 'nothing removed on a refused delete');
  await rejects(as(STRANGER, () => q(`SELECT delete_custom_list_field($1, 'c_origin', 2)`, [L_BEANS])), /no such field/);
  assert.equal(await as(OWNER, () => q(`SELECT delete_custom_list_field($1, 'c_origin', 2) AS n`, [L_BEANS])).then((r) => r[0].n), 2);
  assert.equal((await valuesOf(I_KENYA)).c_origin, undefined);
  assert.equal((await valuesOf(I_KENYA)).c_altitude, 1800, 'other fields untouched');
  const [s] = await q(`SELECT fields, layout FROM custom_list_owner_settings WHERE list_id = $1`, [L_BEANS]);
  assert.ok(!s.fields.some((f) => f.key === 'c_origin'));
  assert.deepEqual(s.layout.field_order, ['rating']);
});

test('DB-13 owner export has their data only; signed-out callers are refused', async () => {
  const [{ e: mine }] = await as(OWNER, () => q(`SELECT export_my_list_owner_data() AS e`));
  assert.equal(mine.brews.length, 3);
  assert.ok(mine.values.length >= 1 && mine.settings.length === 2);
  assert.ok(!JSON.stringify(mine).includes(OWNER), 'no user ids in the export');
  const [{ e: theirs }] = await as(STRANGER, () => q(`SELECT export_my_list_owner_data() AS e`));
  assert.deepEqual(theirs, { settings: [], values: [], brews: [] });
  await rejects(as(null, () => q(`SELECT export_my_list_owner_data()`)), /permission/);
});

test('DB-14 discovery and preview functions do not read the new tables; not in Realtime', async () => {
  const fns = await q(`SELECT proname, prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND proname = ANY($1)`, [['can_view_custom_list', 'get_explore_lists', 'custom_list_anonymous_view', 'get_discoverable_list', 'get_shared_preview']]);
  assert.ok(fns.length >= 4, 'found the discovery functions');
  for (const f of fns) for (const t of NEW_TABLES) assert.ok(!f.prosrc.includes(t), `${f.proname} reads ${t}`);
  const pub = await q(`SELECT tablename FROM pg_publication_tables WHERE tablename = ANY($1)`, [NEW_TABLES]);
  assert.deepEqual(pub, []);
});

test('DB-15 deleting an item or a list removes its values, settings and brews', async () => {
  await as(OWNER, () => q(`DELETE FROM custom_list_items WHERE id = $1`, [I_KENYA]));
  assert.equal(await valuesOf(I_KENYA), undefined);
  assert.equal((await q(`SELECT count(*)::int AS n FROM custom_list_item_brews WHERE item_id = $1`, [I_KENYA]))[0].n, 0);
  await as(OWNER, () => q(`DELETE FROM custom_lists WHERE id = $1`, [L_BEANS]));
  assert.equal((await q(`SELECT count(*)::int AS n FROM custom_list_owner_settings WHERE list_id = $1`, [L_BEANS]))[0].n, 0);
  assert.equal((await q(`SELECT count(*)::int AS n FROM custom_list_item_owner_values WHERE list_id = $1`, [L_BEANS]))[0].n, 0);
});

test('DB-16 rollback removes exactly what was added and leaves existing tables as before', async () => {
  await db.exec(ROLLBACK);
  for (const t of NEW_TABLES) assert.equal((await q(`SELECT to_regclass($1) AS r`, [`public.${t}`]))[0].r, null);
  assert.equal((await q(`SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE 'lv2\\_%' OR proname IN ('delete_custom_list_field', 'count_custom_list_field_values', 'export_my_list_owner_data')`))[0].n, 0);
  assert.deepEqual(await shape(), beforeShape);
  assert.deepEqual(await policies(), beforePolicies);
  await db.exec(SQL); // and it can be applied again afterwards
});
