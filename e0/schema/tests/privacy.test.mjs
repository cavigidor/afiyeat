// Lists V2 - who can read stored detail VALUES under Schema A (PROPOSAL, for review).
// In-process Postgres only. Documents current behaviour; asserts nothing new is exposed.
//   node --test schema/tests/privacy.test.mjs
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture } from './fixture.mjs';

const SCHEMA_A = fs.readFileSync(new URL('../schema_a_proposal.sql', import.meta.url), 'utf8');
const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PUB = id(1);      // public profile, owner
const PRIV = id(2);     // private profile, owner
const FOLLOWER = id(3); // accepted follower of PRIV
const STRANGER = id(4); // signed in, follows nobody
const BLOCKED = id(5);  // blocked by PUB
const R_PUB = id(11), R_PRIV = id(12), R_HIDDEN = id(13);
const L_PUB = id(21), L_PRIV_PROFILE = id(22), L_PUB_ONLY_ME = id(23);
const I_PUB = id(31), I_PRIV = id(32), I_ONLY_ME = id(33);
const SECRET = (s) => ({ secret_value: `SECRET-${s}`, custom_x9: 'owner-defined custom field value' });

let db;
const q = async (sql, p) => (await db.query(sql, p)).rows;
async function as(uid, fn) {
  if (uid) await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false);`);
  else await db.exec(`SET ROLE anon; SELECT set_config('request.jwt.claim.sub', '', false);`);
  try { return await fn(); } finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`); }
}
// true = the caller receives the detail values; false = no row; 'refused' = the query errors.
const sees = async (who, table, rowId) => {
  let r;
  try { r = await as(who, () => q(`SELECT details FROM public.${table} WHERE id = $1`, [rowId])); }
  catch (e) { return 'refused'; }
  return r.length === 1 && JSON.stringify(r[0].details).includes('SECRET-');
};

before(async () => {
  db = await fixture();
  await db.exec(SCHEMA_A);
  for (const [u, priv] of [[PUB, false], [PRIV, true], [FOLLOWER, false], [STRANGER, false], [BLOCKED, false]]) {
    await q(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [u, `${u}@example.test`]);
    if ((await q(`SELECT 1 FROM public.profiles WHERE user_id = $1`, [u])).length === 0) await q(`INSERT INTO public.profiles (user_id, username) VALUES ($1, $2)`, [u, 'u' + u.slice(-2)]);
    await q(`UPDATE public.profiles SET is_private = $2 WHERE user_id = $1`, [u, priv]);
  }
  // A request to a private profile is inserted as pending by a trigger; the owner then accepts it.
  await q(`INSERT INTO public.follows (follower_id, following_id) VALUES ($1, $2)`, [FOLLOWER, PRIV]);
  await q(`UPDATE public.follows SET status = 'accepted' WHERE follower_id = $1 AND following_id = $2`, [FOLLOWER, PRIV]);
  await q(`INSERT INTO public.blocked_users (blocker_id, blocked_id) VALUES ($1, $2)`, [PUB, BLOCKED]);
  await q(`INSERT INTO public.restaurants (id, user_id, name, details) VALUES ($1, $4, 'Pub place', $5), ($2, $6, 'Private place', $7), ($3, $4, 'Hidden place', $8)`,
    [R_PUB, R_PRIV, R_HIDDEN, PUB, SECRET('R-PUB'), PRIV, SECRET('R-PRIV'), SECRET('R-HIDDEN')]);
  await q(`INSERT INTO public.moderation_hidden (content_type, content_id, reason) VALUES ('restaurant', $1, 'moderator')`, [R_HIDDEN]);
  await q(`INSERT INTO public.custom_lists (id, user_id, name, visibility) VALUES ($1, $4, 'Pub list', 'profile'), ($2, $5, 'Priv list', 'profile'), ($3, $4, 'Only me', 'private')`, [L_PUB, L_PRIV_PROFILE, L_PUB_ONLY_ME, PUB, PRIV]);
  await q(`INSERT INTO public.custom_list_items (id, list_id, user_id, name, details) VALUES ($1, $4, $7, 'a', $8), ($2, $5, $9, 'b', $10), ($3, $6, $7, 'c', $11)`,
    [I_PUB, I_PRIV, I_ONLY_ME, L_PUB, L_PRIV_PROFILE, L_PUB_ONLY_ME, PUB, SECRET('I-PUB'), PRIV, SECRET('I-PRIV'), SECRET('I-ONLYME')]);
  await as(PUB, () => q(`SELECT public.patch_restaurants_config('[{"path":["fields","custom_x9","label"],"value":"PRIVATE-LABEL"}]')`));
});

test('My Restaurants details, public profile: readable by any signed-in user (same as notes today); signed-out callers are refused', async () => {
  assert.equal(await sees(PUB, 'restaurants', R_PUB), true);
  assert.equal(await sees(STRANGER, 'restaurants', R_PUB), true);
  // The public-profile SELECT policy itself has no sign-in condition. Signed-out reads fail only because the
  // restrictive moderation policy calls is_moderator(), which anon may not execute. Verify that grant in production.
  assert.equal(await sees(null, 'restaurants', R_PUB), 'refused');
});

test('My Restaurants details, private profile: owner and accepted followers only', async () => {
  assert.equal(await sees(PRIV, 'restaurants', R_PRIV), true);
  assert.equal(await sees(FOLLOWER, 'restaurants', R_PRIV), true);
  assert.equal(await sees(STRANGER, 'restaurants', R_PRIV), false);
  assert.notEqual(await sees(null, 'restaurants', R_PRIV), true);
});

test('My Restaurants details: blocked users and moderation-hidden rows see nothing', async () => {
  assert.equal(await sees(BLOCKED, 'restaurants', R_PUB), false);
  assert.equal(await sees(STRANGER, 'restaurants', R_HIDDEN), false);
  assert.equal(await sees(PUB, 'restaurants', R_HIDDEN), true, 'the owner still sees a hidden row');
});

test('My Restaurants custom-field LABELS are owner-only, but their VALUES are as readable as the row', async () => {
  assert.equal((await as(STRANGER, () => q(`SELECT * FROM public.user_list_settings`))).length, 0);
  assert.equal((await as(null, () => q(`SELECT 1 FROM public.user_list_settings`)).catch(() => [])).length, 0);
  const r = await as(STRANGER, () => q(`SELECT details FROM public.restaurants WHERE id = $1`, [R_PUB]));
  assert.equal(r[0].details.custom_x9, 'owner-defined custom field value', 'value readable without its label');
});

test('Custom-list details: profile list of a public profile is readable by signed-in users only', async () => {
  assert.equal(await sees(STRANGER, 'custom_list_items', I_PUB), true);
  assert.notEqual(await sees(null, 'custom_list_items', I_PUB), true, 'can_view_custom_list requires sign-in');
  assert.equal(await sees(BLOCKED, 'custom_list_items', I_PUB), false);
});

test('Custom-list details: private profile -> accepted followers; Only me list -> owner only', async () => {
  assert.equal(await sees(FOLLOWER, 'custom_list_items', I_PRIV), true);
  assert.equal(await sees(STRANGER, 'custom_list_items', I_PRIV), false);
  assert.equal(await sees(STRANGER, 'custom_list_items', I_ONLY_ME), false);
  assert.equal(await sees(PUB, 'custom_list_items', I_ONLY_ME), true);
});

test('Functions that read restaurants or list items return fixed columns: no detail value appears in their output', async () => {
  const outputs = [];
  const tryCall = async (who, sql, params) => { try { outputs.push(JSON.stringify(await as(who, () => q(sql, params)))); } catch (e) { outputs.push('ERR ' + e.message); } };
  await tryCall(STRANGER, `SELECT public.get_shared_preview('list', $1) v`, [L_PUB]);
  await tryCall(STRANGER, `SELECT public.get_shared_preview('restaurant', $1) v`, [R_PUB]);
  await tryCall(STRANGER, `SELECT * FROM public.get_explore_lists('all', NULL, 50, 0)`);
  for (const o of outputs) assert.ok(!o.startsWith('ERR '), `call failed, so it proves nothing: ${o.slice(0, 160)}`);
  for (const o of outputs) assert.ok(!o.includes('SECRET-') && !o.includes('custom_x9') && !o.includes('PRIVATE-LABEL'), o.slice(0, 200));
});
