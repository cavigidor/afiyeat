// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const directory = new URL('../supabase/migrations/', import.meta.url);
const migrationName = '20261029120000_custom_list_items_owner_check.sql';
const migration = readFileSync(new URL(migrationName, directory), 'utf8');

// Reconstruct the final policies from ALL repository migrations preceding CP1.
// Canonical and Lovable-generated migration copies repeat some definitions;
// retain the last definition by table/name, honoring explicit DROP statements.
// This is the repository's policy state, not a claim about the live catalog.
function priorPolicies() {
  const policies = new Map<string, string>();
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.sql') && name < migrationName).sort()) {
    const sql = readFileSync(new URL(file, directory), 'utf8').replace(/--[^\n]*/g, '');
    const pattern = /\b(CREATE|DROP)\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+public\.(custom_lists|custom_list_items)\b[^;]*;/gi;
    for (const match of sql.matchAll(pattern)) {
      const key = `${match[3]}:${match[2]}`;
      if (match[1].toUpperCase() === 'DROP') policies.delete(key);
      else policies.set(key, match[0]);
    }
  }
  return [...policies.values()].join('\n');
}

function sourceFunction(file: string, name: string) {
  const sql = readFileSync(new URL(file, directory), 'utf8');
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start === -1) throw new Error(`Missing policy helper ${name}`);
  return sql.slice(start, sql.indexOf('$$;', start) + 3);
}

const owner = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const ownList = '10000000-0000-0000-0000-000000000001';
const otherList = '10000000-0000-0000-0000-000000000002';
const secondOwnList = '10000000-0000-0000-0000-000000000003';
const ownItem = '20000000-0000-0000-0000-000000000001';
const otherItem = '20000000-0000-0000-0000-000000000002';
let db: PGlite;
let gapReproduced = false;

async function asUser(user: string, sql: string) {
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${user}';`);
  try { return await db.exec(sql); }
  finally { await db.exec('RESET ROLE'); }
}

async function seed() {
  await db.exec(`
    TRUNCATE custom_list_items, custom_lists, profiles, follows, blocked_users, moderation_hidden, user_roles;
    INSERT INTO profiles VALUES ('${owner}', false), ('${other}', false);
    INSERT INTO custom_lists VALUES ('${ownList}', '${owner}'), ('${otherList}', '${other}'), ('${secondOwnList}', '${owner}');
    INSERT INTO custom_list_items(id, list_id, user_id, name) VALUES
      ('${ownItem}', '${ownList}', '${owner}', 'own'), ('${otherItem}', '${otherList}', '${other}', 'other');
  `);
}

beforeAll(async () => {
  db = new PGlite();
  // Only unrelated table shape/auth plumbing is a fixture. The policy bodies
  // and their block/moderation helpers are read verbatim from the migrations.
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    CREATE TABLE custom_lists(id uuid PRIMARY KEY, user_id uuid NOT NULL);
    CREATE TABLE custom_list_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      list_id uuid NOT NULL REFERENCES custom_lists(id), user_id uuid NOT NULL, name text);
    CREATE TABLE profiles(user_id uuid PRIMARY KEY, is_private boolean);
    CREATE TABLE follows(follower_id uuid, following_id uuid, status text);
    CREATE TABLE blocked_users(blocker_id uuid, blocked_id uuid);
    CREATE TABLE moderation_hidden(content_type text, content_id uuid);
    CREATE TABLE user_roles(user_id uuid, role text);
    GRANT SELECT, INSERT, UPDATE, DELETE ON custom_lists, custom_list_items TO authenticated;
    GRANT SELECT ON profiles, follows TO authenticated;
    ALTER TABLE custom_lists ENABLE ROW LEVEL SECURITY;
    ALTER TABLE custom_list_items ENABLE ROW LEVEL SECURITY;
  `);
  await db.exec(sourceFunction('20260920120000_ugc_safety_report_and_block.sql', 'is_blocked_pair'));
  await db.exec(sourceFunction('20261010120000_moderation_enforcement.sql', 'is_moderation_hidden'));
  await db.exec(sourceFunction('20261010120000_moderation_enforcement.sql', 'is_moderator'));
  await db.exec(priorPolicies());
  await seed();
  await asUser(owner, `INSERT INTO custom_list_items(list_id,user_id,name) VALUES ('${otherList}','${owner}','pre-migration gap')`);
  gapReproduced = true;
  await db.exec(migration);
}, 30000);

beforeEach(seed);
afterAll(async () => { await db?.close(); });

describe('custom-list ownership migration with repository policies', () => {
  it('reproduces the original gap with all prior policies enabled', () => {
    expect(gapReproduced).toBe(true);
  });

  it('has no additional permissive INSERT, UPDATE or ALL policy bypass', async () => {
    const { rows } = await db.query<{ policyname: string; cmd: string; roles: string[] }>(`
      SELECT policyname, cmd, roles FROM pg_policies
      WHERE schemaname='public' AND tablename='custom_list_items'
        AND permissive='PERMISSIVE' AND cmd IN ('INSERT','UPDATE','ALL') ORDER BY cmd
    `);
    expect(rows).toEqual([
      { policyname: 'Users can insert their own custom list items', cmd: 'INSERT', roles: ['authenticated'] },
      { policyname: 'Users can update their own custom list items', cmd: 'UPDATE', roles: ['authenticated'] },
    ]);
    const policies = await db.query<{ n: number }>("SELECT count(*)::int n FROM pg_policies WHERE tablename='custom_list_items'");
    expect(policies.rows[0].n).toBe(8);
  });

  it('can be applied again without changing policies or rows', async () => {
    const before = await db.query('SELECT * FROM pg_policies ORDER BY tablename, policyname');
    await db.exec(migration);
    expect((await db.query('SELECT * FROM pg_policies ORDER BY tablename, policyname')).rows).toEqual(before.rows);
    expect((await db.query('SELECT * FROM custom_list_items')).rows).toHaveLength(2);
  });

  it('permits legitimate owner insert, edit and delete operations', async () => {
    const result = await asUser(owner, `
      INSERT INTO custom_list_items(list_id,user_id,name) VALUES ('${ownList}','${owner}','new') RETURNING id;
      UPDATE custom_list_items SET name='updated' WHERE name='new' RETURNING id;
      DELETE FROM custom_list_items WHERE name='updated' RETURNING id;
    `);
    expect(result.map((r) => r.rows.length)).toEqual([1, 1, 1]);
  });

  it('permits moving an item between two lists owned by the caller', async () => {
    const result = await asUser(owner, `UPDATE custom_list_items SET list_id='${secondOwnList}' WHERE id='${ownItem}' RETURNING id`);
    expect(result[0].affectedRows).toBe(1);
  });

  it.each([[owner, otherList], [other, ownList]])('rejects caller %s inserting into foreign list %s', async (user, listId) => {
    await expect(asUser(user, `INSERT INTO custom_list_items(list_id,user_id,name) VALUES ('${listId}','${user}','bad')`)).rejects.toMatchObject({ code: '42501' });
  });

  it('rejects a forged user_id even when the list is owned', async () => {
    await expect(asUser(owner, `INSERT INTO custom_list_items(list_id,user_id,name) VALUES ('${ownList}','${other}','forged')`)).rejects.toMatchObject({ code: '42501' });
  });

  it('rejects moving an existing item into another user list', async () => {
    await expect(asUser(owner, `UPDATE custom_list_items SET list_id='${otherList}' WHERE id='${ownItem}'`)).rejects.toMatchObject({ code: '42501' });
  });

  it('rejects reassigning an existing item user_id', async () => {
    await expect(asUser(owner, `UPDATE custom_list_items SET user_id='${other}' WHERE id='${ownItem}'`)).rejects.toMatchObject({ code: '42501' });
  });

  it('does not let public-profile read access authorize editing or deleting others items', async () => {
    const result = await asUser(owner, `SELECT * FROM custom_list_items WHERE id='${otherItem}';
      UPDATE custom_list_items SET name='hijack' WHERE id='${otherItem}';
      DELETE FROM custom_list_items WHERE id='${otherItem}';`);
    expect(result[0].rows).toHaveLength(1);
    expect(result.slice(1).map((r) => r.affectedRows)).toEqual([0, 0]);
  });

  it('preserves follower SELECT access without granting foreign-list writes', async () => {
    await db.exec(`UPDATE profiles SET is_private=true WHERE user_id='${other}';
      INSERT INTO follows VALUES('${owner}','${other}','accepted');`);
    const result = await asUser(owner, `SELECT * FROM custom_list_items WHERE id='${otherItem}'`);
    expect(result[0].rows).toHaveLength(1);
    await expect(asUser(owner, `INSERT INTO custom_list_items(list_id,user_id,name) VALUES('${otherList}','${owner}','bad')`)).rejects.toMatchObject({ code: '42501' });
  });

  it('preserves restrictive block visibility', async () => {
    await db.exec(`INSERT INTO blocked_users VALUES('${owner}','${other}')`);
    const result = await asUser(owner, `SELECT * FROM custom_list_items WHERE id='${otherItem}'`);
    expect(result[0].rows).toHaveLength(0);
  });

  it('preserves moderation hiding and still permits the owner to edit their own hidden item', async () => {
    await db.exec(`INSERT INTO moderation_hidden VALUES('custom_list_item','${ownItem}'),('custom_list','${ownList}')`);
    expect((await asUser(other, `SELECT * FROM custom_list_items WHERE id='${ownItem}'`))[0].rows).toHaveLength(0);
    expect((await asUser(owner, `UPDATE custom_list_items SET name='owner edit' WHERE id='${ownItem}'`))[0].affectedRows).toBe(1);
  });

  it('leaves legacy mismatches intact but refuses further edits until moved to an owned list', async () => {
    await db.exec(`UPDATE custom_list_items SET list_id='${otherList}' WHERE id='${ownItem}'`);
    await db.exec(migration);
    expect((await db.query(`SELECT list_id FROM custom_list_items WHERE id='${ownItem}'`)).rows).toEqual([{ list_id: otherList }]);
    await expect(asUser(owner, `UPDATE custom_list_items SET name='bad edit' WHERE id='${ownItem}'`)).rejects.toMatchObject({ code: '42501' });
    expect((await asUser(owner, `UPDATE custom_list_items SET list_id='${ownList}' WHERE id='${ownItem}'`))[0].affectedRows).toBe(1);
  });

  it('does not grant anonymous inserts', async () => {
    await db.exec('SET ROLE anon');
    try {
      await expect(db.exec(`INSERT INTO custom_list_items(list_id,user_id,name) VALUES('${ownList}','${owner}','anon')`)).rejects.toMatchObject({ code: '42501' });
    } finally { await db.exec('RESET ROLE'); }
  });
});
