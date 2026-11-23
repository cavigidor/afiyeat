// Lists V2 - Schema A addendum - tests (PROPOSAL, for review).
// Same in-process fixture as schema_a.test.mjs. Never touches a shared database.
//   node --test schema_a_addendum.test.mjs
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture } from './fixture.mjs';

const SCHEMA_A = fs.readFileSync(new URL('../schema_a_proposal.sql', import.meta.url), 'utf8');
const ADDENDUM = fs.readFileSync(new URL('../schema_a_addendum_owner_check.sql', import.meta.url), 'utf8');
const OWNER = '00000000-0000-4000-8000-00000000000a';
const OTHER = '00000000-0000-4000-8000-00000000000b';
const LIST = '10000000-0000-4000-8000-000000000001';
const OTHER_LIST = '10000000-0000-4000-8000-000000000002';

let db;
const q = async (sql, params) => (await db.query(sql, params)).rows;
async function as(uid, fn) {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await fn(); } finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`); }
}
const refused = async (fn) => { try { await fn(); return false; } catch { return true; } };

before(async () => {
  db = await fixture();
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${OWNER}', 'owner@example.test'), ('${OTHER}', 'other@example.test');
    INSERT INTO public.profiles (user_id, username) VALUES ('${OWNER}', 'owner'), ('${OTHER}', 'other') ON CONFLICT DO NOTHING;
    INSERT INTO public.custom_lists (id, user_id, name) VALUES ('${LIST}', '${OWNER}', 'Wines'), ('${OTHER_LIST}', '${OTHER}', 'Other list');
  `);
  await db.exec(SCHEMA_A);
});

test('1. BEFORE the addendum: another user can attach a status and a category to a list they do not own, and the owner sees them', async () => {
  await as(OTHER, () => q(`INSERT INTO public.custom_list_statuses (list_id, user_id, name) VALUES ($1, $2, 'Injected status')`, [LIST, OTHER]));
  await as(OTHER, () => q(`INSERT INTO public.custom_list_types (list_id, user_id, name) VALUES ($1, $2, 'Injected category')`, [LIST, OTHER]));
  const seen = await as(OWNER, () => q(`SELECT name FROM public.custom_list_statuses WHERE list_id = $1 UNION ALL SELECT name FROM public.custom_list_types WHERE list_id = $1`, [LIST]));
  assert.deepEqual(seen.map((r) => r.name).sort(), ['Injected category', 'Injected status']);
  await db.exec(`DELETE FROM public.custom_list_statuses WHERE name LIKE 'Injected%'; DELETE FROM public.custom_list_types WHERE name LIKE 'Injected%';`);
});

test('2. AFTER the addendum: both inserts are refused', async () => {
  await db.exec(ADDENDUM);
  assert.ok(await refused(() => as(OTHER, () => q(`INSERT INTO public.custom_list_statuses (list_id, user_id, name) VALUES ($1, $2, 'Injected status')`, [LIST, OTHER]))));
  assert.ok(await refused(() => as(OTHER, () => q(`INSERT INTO public.custom_list_types (list_id, user_id, name) VALUES ($1, $2, 'Injected category')`, [LIST, OTHER]))));
  assert.equal((await q(`SELECT count(*)::int n FROM public.custom_list_statuses WHERE list_id = $1`, [LIST]))[0].n, 0);
});

test('3. A row cannot be moved onto someone else\'s list by an update', async () => {
  await as(OTHER, () => q(`INSERT INTO public.custom_list_statuses (list_id, user_id, name) VALUES ($1, $2, 'Mine')`, [OTHER_LIST, OTHER]));
  assert.ok(await refused(() => as(OTHER, () => q(`UPDATE public.custom_list_statuses SET list_id = $1 WHERE name = 'Mine'`, [LIST]))));
  await as(OTHER, () => q(`INSERT INTO public.custom_list_types (list_id, user_id, name) VALUES ($1, $2, 'Mine')`, [OTHER_LIST, OTHER]));
  assert.ok(await refused(() => as(OTHER, () => q(`UPDATE public.custom_list_types SET list_id = $1 WHERE name = 'Mine'`, [LIST]))));
});

test('4. The owner can still add, rename and reorder statuses and categories', async () => {
  await as(OWNER, async () => {
    await q(`INSERT INTO public.custom_list_statuses (list_id, user_id, name, sort_order) VALUES ($1, $2, 'To Try', 0)`, [LIST, OWNER]);
    await q(`UPDATE public.custom_list_statuses SET name = 'Want to Try', sort_order = 1 WHERE list_id = $1`, [LIST]);
    await q(`INSERT INTO public.custom_list_types (list_id, user_id, name) VALUES ($1, $2, 'Red')`, [LIST, OWNER]);
    await q(`UPDATE public.custom_list_types SET name = 'Reds', is_hidden = true WHERE list_id = $1`, [LIST]);
  });
  assert.equal((await q(`SELECT name FROM public.custom_list_statuses WHERE list_id = $1`, [LIST]))[0].name, 'Want to Try');
  assert.equal((await q(`SELECT name FROM public.custom_list_types WHERE list_id = $1`, [LIST]))[0].name, 'Reds');
});

test('5. create_list_from_preset still creates statuses and categories for the caller', async () => {
  const NEW = '10000000-0000-4000-8000-000000000009';
  await as(OWNER, () => q(`SELECT create_list_from_preset($1, 'Drinks', 'drinks', 1, NULL, '{}'::jsonb, '["Want to Try", "Tried"]'::jsonb, '[{"name": "Beer", "preset_key": "beer"}]'::jsonb)`, [NEW]));
  const r = (await q(`SELECT (SELECT count(*)::int FROM public.custom_list_statuses WHERE list_id = $1) s, (SELECT count(*)::int FROM public.custom_list_types WHERE list_id = $1) t`, [NEW]))[0];
  assert.deepEqual([r.s, r.t], [2, 1]);
});

test('6. The addendum applies twice without error', async () => { await db.exec(ADDENDUM); });
