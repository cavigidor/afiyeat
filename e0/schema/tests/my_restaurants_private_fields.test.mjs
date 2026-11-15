// Lists V2 - My Restaurants private custom fields (option P1, PROPOSAL). In-process Postgres only.
// Readers: owner, accepted follower (private profile), stranger (public profile), blocked user,
// signed-out caller. Proves custom VALUES are owner-only while preset details keep the row's
// existing audience and custom-list details keep their explicit audience.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture } from './fixture.mjs';

const SCHEMA_A = fs.readFileSync(new URL('../schema_a_proposal.sql', import.meta.url), 'utf8');
const P1 = fs.readFileSync(new URL('../schema_a_my_restaurants_private_fields.sql', import.meta.url), 'utf8');
const id = (n) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PUB = id(1), PRIV = id(2), FOLLOWER = id(3), STRANGER = id(4), BLOCKED = id(5), FAN = id(6);
const R_PUB = id(11), R_PRIV = id(12), R_STRANGER = id(13);
const L_PROFILE = id(21), L_ONLY_ME = id(22), I_PROFILE = id(31), I_ONLY_ME = id(32);

let db;
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
/** What a caller gets back: 'refused' (error), [] (no row), or the rows. */
const read = async (who, sql, p) => { try { return await as(who, () => q(sql, p)); } catch { return 'refused'; } };
const privateValues = (who, r) => read(who, `SELECT "values" FROM public.restaurant_private_details WHERE restaurant_id = $1`, [r]);
const defineField = (who, key, label) => as(who, () => q(`SELECT patch_restaurants_config($1::jsonb)`, [JSON.stringify([{ path: ['custom_fields', key, 'label'], value: label }])]));

before(async () => {
  db = await fixture();
  await db.exec(SCHEMA_A);
  await db.exec(P1);
  for (const [u, priv] of [[PUB, false], [PRIV, true], [FOLLOWER, false], [STRANGER, false], [BLOCKED, false], [FAN, false]]) {
    await q(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [u, `${u}@example.test`]);
    if ((await q(`SELECT 1 FROM public.profiles WHERE user_id = $1`, [u])).length === 0) await q(`INSERT INTO public.profiles (user_id, username) VALUES ($1, $2)`, [u, 'p' + u.slice(-2)]);
    await q(`UPDATE public.profiles SET is_private = $2 WHERE user_id = $1`, [u, priv]);
  }
  await q(`INSERT INTO public.follows (follower_id, following_id) VALUES ($1, $2), ($3, $4)`, [FOLLOWER, PRIV, FAN, PUB]);
  await q(`UPDATE public.follows SET status = 'accepted'`);
  await q(`INSERT INTO public.blocked_users (blocker_id, blocked_id) VALUES ($1, $2)`, [PUB, BLOCKED]);
  await q(`INSERT INTO public.restaurants (id, user_id, name, details) VALUES ($1, $2, 'Pub place', '{"dishes":["Bao"]}'), ($3, $4, 'Priv place', '{"dishes":["Mole"]}'), ($5, $6, 'Strangers place', '{}')`,
    [R_PUB, PUB, R_PRIV, PRIV, R_STRANGER, STRANGER]);
  await q(`INSERT INTO public.custom_lists (id, user_id, name, visibility) VALUES ($1, $3, 'Profile list', 'profile'), ($2, $3, 'Only me', 'private')`, [L_PROFILE, L_ONLY_ME, PUB]);
  await q(`INSERT INTO public.custom_list_items (id, list_id, user_id, name, details) VALUES ($1, $2, $5, 'a', '{"origin":"Kenya"}'), ($3, $4, $5, 'b', '{"origin":"Peru"}')`, [I_PROFILE, L_PROFILE, I_ONLY_ME, L_ONLY_ME, PUB]);
  for (const owner of [PUB, PRIV]) await defineField(owner, 'c_went_with', 'Went with');
  await as(PUB, () => q(`SELECT patch_restaurant_private_details($1, '{"c_went_with":"PRIVATE-Alex"}')`, [R_PUB]));
  await as(PRIV, () => q(`SELECT patch_restaurant_private_details($1, '{"c_went_with":"PRIVATE-Sam"}')`, [R_PRIV]));
});

test('P1-1 applies cleanly on Schema A and a second time', async () => { await db.exec(P1); });

test('P1-2 the owner reads their custom values; the values are not in restaurants.details', async () => {
  assert.deepEqual(await privateValues(PUB, R_PUB), [{ values: { c_went_with: 'PRIVATE-Alex' } }]);
  const [r] = await q(`SELECT details FROM restaurants WHERE id = $1`, [R_PUB]);
  assert.ok(!JSON.stringify(r.details).includes('PRIVATE-'));
});

test('P1-3 nobody but the owner reads custom values: follower, fan, stranger, blocked, signed-out', async () => {
  for (const who of [FAN, STRANGER, BLOCKED]) assert.deepEqual(await privateValues(who, R_PUB), [], `reader ${who}`);
  assert.deepEqual(await privateValues(FOLLOWER, R_PRIV), []);
  assert.deepEqual(await privateValues(STRANGER, R_PRIV), []);
  assert.equal(await privateValues(null, R_PUB), 'refused', 'anon has no privilege on the table');
  assert.equal((await read(STRANGER, `SELECT * FROM restaurant_private_details`)).length, 0);
});

test('P1-4 preset details keep the row\'s existing audience (unchanged by P1)', async () => {
  const dishes = async (who, r) => { const x = await read(who, `SELECT details FROM restaurants WHERE id = $1`, [r]); return x === 'refused' ? x : x.map((y) => y.details.dishes); };
  assert.deepEqual(await dishes(STRANGER, R_PUB), [['Bao']], 'public profile: any signed-in user, as today');
  assert.deepEqual(await dishes(FOLLOWER, R_PRIV), [['Mole']], 'private profile: accepted follower');
  assert.deepEqual(await dishes(STRANGER, R_PRIV), []);
  assert.deepEqual(await dishes(BLOCKED, R_PUB), []);
  assert.notDeepEqual(await dishes(null, R_PUB), [['Bao']]);
});

test('P1-5 custom-list details keep their explicit audience (Only me vs profile), unchanged by P1', async () => {
  const origin = async (who, i) => { const x = await read(who, `SELECT details FROM custom_list_items WHERE id = $1`, [i]); return x === 'refused' ? x : x.length; };
  assert.equal(await origin(STRANGER, I_PROFILE), 1);
  assert.equal(await origin(STRANGER, I_ONLY_ME), 0);
  assert.equal(await origin(FAN, I_ONLY_ME), 0);
  assert.equal(await origin(PUB, I_ONLY_ME), 1);
});

test('P1-6 a custom key can never be written into restaurants.details, by any path', async () => {
  await rejects(as(PUB, () => q(`SELECT patch_restaurant_details($1, '{"c_went_with":"leak"}')`, [R_PUB])), /no_custom|23514/);
  await rejects(as(PUB, () => q(`UPDATE restaurants SET details = details || '{"c_x":"leak"}' WHERE id = $1`, [R_PUB])), /no_custom|23514/);
  await rejects(as(PUB, () => q(`INSERT INTO restaurants (user_id, name, details) VALUES ($1, 'n', '{"c_x":"leak"}')`, [PUB])), /no_custom|23514/);
});

test('P1-7 values are accepted only for keys the owner defined, and only custom keys', async () => {
  await rejects(as(PUB, () => q(`SELECT patch_restaurant_private_details($1, '{"c_budget":"40"}')`, [R_PUB])), /22023/);
  await rejects(as(PUB, () => q(`SELECT patch_restaurant_private_details($1, '{"dishes":["x"]}')`, [R_PUB])), /22023/);
  await rejects(as(PUB, () => q(`UPDATE restaurant_private_details SET "values" = '{"dishes":"x"}' WHERE restaurant_id = $1`, [R_PUB])), /23514/);
  // A definition created by someone else does not count for this owner.
  await defineField(STRANGER, 'c_budget', 'Budget');
  await rejects(as(PUB, () => q(`SELECT patch_restaurant_private_details($1, '{"c_budget":"40"}')`, [R_PUB])), /22023/);
});

test('P1-8 definitions: custom keys only under custom_fields, never c_ keys under preset fields', async () => {
  await rejects(as(PUB, () => q(`SELECT patch_restaurants_config('[{"path":["custom_fields","went_with","label"],"value":"x"}]')`)), /23514|config/);
  await rejects(as(PUB, () => q(`SELECT patch_restaurants_config('[{"path":["fields","c_went_with","hidden"],"value":true}]')`)), /23514|config/);
  await as(PUB, () => q(`SELECT patch_restaurants_config('[{"path":["fields","dishes","hidden"],"value":true}]')`));
  assert.equal((await read(STRANGER, `SELECT restaurants_config FROM user_list_settings WHERE user_id = $1`, [PUB])).length, 0, 'definitions stay owner-only');
});

test('P1-9 cross-user: no insert, update, move or delete of private values on another user\'s place', async () => {
  await rejects(as(STRANGER, () => q(`SELECT patch_restaurant_private_details($1, '{"c_budget":"1"}')`, [R_PUB])), /42501/);
  await rejects(as(STRANGER, () => q(`INSERT INTO restaurant_private_details (restaurant_id, user_id, "values") VALUES ($1, $2, '{}')`, [R_PUB, STRANGER])), /row-level security|42501/);
  await rejects(as(STRANGER, () => q(`INSERT INTO restaurant_private_details (restaurant_id, user_id, "values") VALUES ($1, $2, '{}')`, [R_PUB, PUB])), /row-level security|42501/);
  const upd = await as(STRANGER, () => q(`UPDATE restaurant_private_details SET "values" = '{}' WHERE restaurant_id = $1 RETURNING 1`, [R_PUB]));
  assert.equal(upd.length, 0);
  const del = await as(STRANGER, () => q(`DELETE FROM restaurant_private_details WHERE restaurant_id = $1 RETURNING 1`, [R_PUB]));
  assert.equal(del.length, 0);
  // Owner of their own row cannot re-point it at someone else's place.
  await as(STRANGER, () => q(`SELECT patch_restaurant_private_details($1, '{"c_budget":"1"}')`, [R_STRANGER]));
  await rejects(as(STRANGER, () => q(`UPDATE restaurant_private_details SET restaurant_id = $1 WHERE restaurant_id = $2`, [R_PUB, R_STRANGER])), /row-level security|42501|23505/);
  assert.deepEqual(await privateValues(PUB, R_PUB), [{ values: { c_went_with: 'PRIVATE-Alex' } }]);
});

test('P1-10 deleting the place deletes its private values', async () => {
  const R = id(14);
  await as(PUB, async () => {
    await q(`INSERT INTO restaurants (id, user_id, name) VALUES ($1, $2, 'Temp')`, [R, PUB]);
    await q(`SELECT patch_restaurant_private_details($1, '{"c_went_with":"x"}')`, [R]);
    await q(`DELETE FROM restaurants WHERE id = $1`, [R]);
  });
  assert.equal((await q(`SELECT 1 FROM restaurant_private_details WHERE restaurant_id = $1`, [R])).length, 0);
});

test('P1-11 not published to Realtime; anon holds no privilege; functions return no custom value', async () => {
  assert.equal((await q(`SELECT 1 FROM pg_publication_tables WHERE tablename = 'restaurant_private_details'`)).length, 0);
  const priv = await q(`SELECT privilege_type FROM information_schema.role_table_grants WHERE table_name = 'restaurant_private_details' AND grantee IN ('anon', 'PUBLIC')`);
  assert.deepEqual(priv, []);
  const outs = [];
  for (const [sql, p] of [[`SELECT public.get_shared_preview('restaurant', $1) v`, [R_PUB]], [`SELECT * FROM public.get_explore_places('all')`, []], [`SELECT * FROM public.get_discovery_places('all')`, []]]) {
    const r = await read(STRANGER, sql, p);
    assert.notEqual(r, 'refused', `${sql} must run, or this check proves nothing`);
    outs.push(JSON.stringify(r));
  }
  for (const o of outs) assert.ok(!o.includes('PRIVATE-'), o.slice(0, 200));
});

// ---------------------------------------------------------------- PM decisions O1-O3 (2026-11-15)
const config = async (who) => (await as(who, () => q(`SELECT restaurants_config c FROM user_list_settings WHERE user_id = $1`, [who])))[0]?.c;
const setup2 = async () => {
  const R2 = id(15);
  await as(PUB, async () => {
    await q(`INSERT INTO restaurants (id, user_id, name) VALUES ($1, $2, 'Second') ON CONFLICT DO NOTHING`, [R2, PUB]);
    await q(`SELECT patch_restaurants_config('[{"path":["custom_fields","c_budget","label"],"value":"Budget"}]')`);
    await q(`SELECT patch_restaurant_private_details($1, '{"c_budget":"40"}')`, [R_PUB]);
    await q(`SELECT patch_restaurant_private_details($1, '{"c_budget":"25"}')`, [R2]);
  });
  return R2;
};

test('P1-12 O1 hiding a field keeps every value; unhiding shows them again', async () => {
  await setup2();
  await as(PUB, () => q(`SELECT patch_restaurants_config('[{"path":["custom_fields","c_budget","hidden"],"value":true}]')`));
  assert.equal((await config(PUB)).custom_fields.c_budget.hidden, true);
  assert.equal(await as(PUB, async () => (await q(`SELECT count_restaurant_custom_field_values('c_budget') n`))[0].n), 2);
  await as(PUB, () => q(`SELECT patch_restaurants_config('[{"path":["custom_fields","c_budget","hidden"],"value":false}]')`));
  assert.equal(await as(PUB, async () => (await q(`SELECT count_restaurant_custom_field_values('c_budget') n`))[0].n), 2);
});

test('P1-13 O1 a definition with values cannot be removed by a config patch or a direct update', async () => {
  await rejects(as(PUB, () => q(`SELECT patch_restaurants_config('[{"path":["custom_fields","c_budget"]}]')`)), /still has values|23503/);
  await rejects(as(PUB, () => q(`UPDATE user_list_settings SET restaurants_config = restaurants_config #- '{custom_fields,c_budget}' WHERE user_id = $1`, [PUB])), /still has values|23503/);
  assert.ok((await config(PUB)).custom_fields.c_budget);
  // A field without values can be removed by a plain patch.
  await as(PUB, () => q(`SELECT patch_restaurants_config('[{"path":["custom_fields","c_unused","label"],"value":"Unused"}]')`));
  await as(PUB, () => q(`SELECT patch_restaurants_config('[{"path":["custom_fields","c_unused"]}]')`));
  assert.equal((await config(PUB)).custom_fields.c_unused, undefined);
});

test('P1-14 O1 permanent delete needs the current count, then removes values and definition together', async () => {
  const n = await as(PUB, async () => (await q(`SELECT count_restaurant_custom_field_values('c_budget') n`))[0].n);
  assert.equal(n, 2);
  await rejects(as(PUB, () => q(`SELECT delete_restaurant_custom_field('c_budget', NULL)`)), /22023/);
  await rejects(as(PUB, () => q(`SELECT delete_restaurant_custom_field('c_budget', 1)`)), /now 2, not 1|40001/);
  assert.equal(await as(PUB, async () => (await q(`SELECT count_restaurant_custom_field_values('c_budget') n`))[0].n), 2, 'a refused delete changes nothing');
  await rejects(as(STRANGER, () => q(`SELECT delete_restaurant_custom_field('c_went_with', 0)`)), /no custom field|22023/);
  await rejects(as(PUB, () => q(`SELECT delete_restaurant_custom_field('dishes', 0)`)), /22023/);
  const removed = await as(PUB, async () => (await q(`SELECT delete_restaurant_custom_field('c_budget', 2) n`))[0].n);
  assert.equal(removed, 2);
  assert.equal((await config(PUB)).custom_fields.c_budget, undefined);
  const left = await q(`SELECT "values" FROM restaurant_private_details WHERE user_id = $1`, [PUB]);
  assert.ok(left.every((r) => !('c_budget' in r.values)));
  assert.deepEqual((await privateValues(PUB, R_PUB))[0].values, { c_went_with: 'PRIVATE-Alex' }, 'other fields untouched');
  assert.equal((await q(`SELECT count(*)::int n FROM restaurant_private_details WHERE restaurant_id = $1`, [id(15)]))[0].n, 0, 'emptied rows removed');
  // Another owner's same-named field is untouched.
  assert.ok((await config(PRIV)).custom_fields.c_went_with);
});

test('P1-15 O3 owner export holds definitions and values; nobody else gets any; no definer function reads the table', async () => {
  const mine = await as(PUB, async () => (await q(`SELECT export_my_restaurant_private_fields() e`))[0].e);
  assert.ok(mine.definitions.c_went_with);
  assert.deepEqual(mine.values.map((v) => v.values), [{ c_went_with: 'PRIVATE-Alex' }]);
  const other = await as(STRANGER, async () => (await q(`SELECT export_my_restaurant_private_fields() e`))[0].e);
  assert.ok(!JSON.stringify(other).includes('PRIVATE-'));
  assert.equal(await read(null, `SELECT export_my_restaurant_private_fields()`), 'refused');
  const definers = await q(`SELECT p.oid::regprocedure::text f FROM pg_proc p WHERE p.prosecdef AND p.prosrc ILIKE '%restaurant_private_details%'`);
  assert.deepEqual(definers, [], 'tripwire: a SECURITY DEFINER function reads private values');
  const grants = await q(`SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') a FROM pg_proc p
    WHERE p.proname IN ('count_restaurant_custom_field_values','delete_restaurant_custom_field','export_my_restaurant_private_fields','patch_restaurant_private_details')`);
  assert.ok(grants.length === 4 && grants.every((g) => g.a === false), JSON.stringify(grants));
});
