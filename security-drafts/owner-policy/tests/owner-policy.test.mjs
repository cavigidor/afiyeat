// Security draft tests. In-process Postgres only, on BOTH possible production states:
// main alone, and main + the integration stack (origin/stack/14-photo-records-owner-check).
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDatabase } from '../harness/migrations.mjs';

const FIX = readFileSync(new URL('../fix.sql', import.meta.url), 'utf8');
const ROLLBACK = readFileSync(new URL('../rollback.sql', import.meta.url), 'utf8');
const POSTCHECK = readFileSync(new URL('../postcheck.sql', import.meta.url), 'utf8');
const STACK = process.env.E0_STACK_REF ?? 'origin/stack/14-photo-records-owner-check';
const OWNER = '00000000-0000-4000-8000-00000000000a', OTHER = '00000000-0000-4000-8000-00000000000b';
const LIST = '10000000-0000-4000-8000-000000000001', OTHER_LIST = '10000000-0000-4000-8000-000000000002';

const POLICIES_SQL = `SELECT tablename, policyname, cmd, permissive, roles::text, coalesce(qual, '') q, coalesce(with_check, '') w
  FROM pg_policies WHERE schemaname IN ('public', 'storage') ORDER BY 1, 2`;

async function setup(stackRef) {
  const db = await buildDatabase({ stackRef });
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${OWNER}', 'owner@example.test'), ('${OTHER}', 'other@example.test');
    INSERT INTO public.profiles (user_id, username) VALUES ('${OWNER}', 'owner'), ('${OTHER}', 'other') ON CONFLICT DO NOTHING;
    INSERT INTO public.custom_lists (id, user_id, name) VALUES ('${LIST}', '${OWNER}', 'Wines'), ('${OTHER_LIST}', '${OTHER}', 'Other list');`);
  const q = async (sql, p) => (await db.query(sql, p)).rows;
  const as = async (uid, fn) => {
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false);`);
    try { return await fn(); } finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`); }
  };
  const refused = async (fn) => { try { await fn(); return false; } catch { return true; } };
  return { db, q, as, refused };
}

for (const [label, stackRef] of [['main only', undefined], ['main + stack', STACK]]) {
  test(`${label}: the gap exists before, is closed after, owner flows keep working, rollback is exact`, async () => {
    const { db, q, as, refused } = await setup(stackRef);
    try {
      const before = await q(POLICIES_SQL);

      // 1. Gap before the fix
      await as(OTHER, () => q(`INSERT INTO custom_list_statuses (list_id, user_id, name) VALUES ($1, $2, 'Injected')`, [LIST, OTHER]));
      await as(OTHER, () => q(`INSERT INTO custom_list_types (list_id, user_id, name) VALUES ($1, $2, 'Injected')`, [LIST, OTHER]));
      const [{ id: foreignStatus }] = await q(`SELECT id FROM custom_list_statuses WHERE name = 'Injected'`);

      // 2. Apply the fix (twice: idempotent)
      await db.exec(FIX); await db.exec(FIX);

      // 3. Foreign inserts and moves are refused
      assert.ok(await refused(() => as(OTHER, () => q(`INSERT INTO custom_list_statuses (list_id, user_id, name) VALUES ($1, $2, 'x')`, [LIST, OTHER]))));
      assert.ok(await refused(() => as(OTHER, () => q(`INSERT INTO custom_list_types (list_id, user_id, name) VALUES ($1, $2, 'x')`, [LIST, OTHER]))));
      const [{ id: own }] = await as(OTHER, () => q(`INSERT INTO custom_list_statuses (list_id, user_id, name) VALUES ($1, $2, 'Mine') RETURNING id`, [OTHER_LIST, OTHER]));
      assert.ok(await refused(() => as(OTHER, () => q(`UPDATE custom_list_statuses SET list_id = $1 WHERE id = $2`, [LIST, own]))));
      const [{ id: ownType }] = await as(OTHER, () => q(`INSERT INTO custom_list_types (list_id, user_id, name) VALUES ($1, $2, 'Mine') RETURNING id`, [OTHER_LIST, OTHER]));
      assert.ok(await refused(() => as(OTHER, () => q(`UPDATE custom_list_types SET list_id = $1 WHERE id = $2`, [LIST, ownType]))));

      // 4. Owner flows: create, rename, reorder, delete statuses and categories on their own list
      const [{ id: s1 }] = await as(OWNER, () => q(`INSERT INTO custom_list_statuses (list_id, user_id, name, sort_order) VALUES ($1, $2, 'To Try', 0) RETURNING id`, [LIST, OWNER]));
      await as(OWNER, () => q(`UPDATE custom_list_statuses SET name = 'Want to Try', sort_order = 2 WHERE id = $1`, [s1]));
      const [{ id: t1 }] = await as(OWNER, () => q(`INSERT INTO custom_list_types (list_id, user_id, name) VALUES ($1, $2, 'Red') RETURNING id`, [LIST, OWNER]));
      await as(OWNER, () => q(`UPDATE custom_list_types SET name = 'Reds' WHERE id = $1`, [t1]));
      assert.equal((await as(OWNER, () => q(`DELETE FROM custom_list_types WHERE id = $1 RETURNING 1`, [t1]))).length, 1);

      // 5. Existing foreign rows are NOT deleted or changed by the fix; their writer can no longer update them
      //    (the row is on a list they do not own) but can still delete them. See README "owner decisions".
      assert.equal((await q(`SELECT count(*)::int n FROM custom_list_statuses WHERE id = $1`, [foreignStatus]))[0].n, 1);
      assert.ok(await refused(() => as(OTHER, () => q(`UPDATE custom_list_statuses SET name = 'still mine' WHERE id = $1`, [foreignStatus]))));
      assert.equal((await as(OWNER, () => q(`DELETE FROM custom_list_statuses WHERE id = $1 RETURNING 1`, [foreignStatus]))).length, 0, 'the list owner cannot delete it either (owner decision O-S1)');

      // 6. Nothing but the four policies changed
      const after = await q(POLICIES_SQL);
      const key = (r) => `${r.tablename}.${r.policyname}`;
      const changed = after.filter((r) => JSON.stringify(r) !== JSON.stringify(before.find((b) => key(b) === key(r)))).map(key).sort();
      assert.deepEqual(changed, ['custom_list_statuses.Users can insert their own list statuses', 'custom_list_statuses.Users can update their own list statuses',
        'custom_list_types.Users can insert their own list types', 'custom_list_types.Users can update their own list types']);
      assert.equal(after.length, before.length);

      // 7. The post-check shows one permissive policy per table and command
      const pc = await q(POSTCHECK);
      assert.equal(pc.length, 4);
      for (const r of pc) { assert.equal(Number(r.permissive_policies), 1, JSON.stringify(r)); assert.match(r.with_check_full_text, /custom_lists l/); }

      // 8. Rollback restores main's definitions exactly
      await db.exec(ROLLBACK);
      assert.deepEqual(await q(POLICIES_SQL), before);
    } finally { await db.close(); }
  });

  test(`${label}: the fix stops, changing nothing, if an extra permissive write policy exists`, async () => {
    const { db, q } = await setup(stackRef);
    try {
      await db.exec(`CREATE POLICY "Anyone may add statuses" ON public.custom_list_statuses FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);`);
      const before = await q(POLICIES_SQL);
      await assert.rejects(db.exec(FIX), /unexpected permissive write policies/);
      await db.exec('ROLLBACK').catch(() => {});
      assert.deepEqual(await q(POLICIES_SQL), before);
      const pc = await q(POSTCHECK);
      assert.equal(Number(pc.find((r) => r.tablename === 'custom_list_statuses' && r.cmd === 'INSERT').permissive_policies), 2);
    } finally { await db.close(); }
  });
}
