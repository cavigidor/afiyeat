// @vitest-environment node
//
// CP2 privacy tests, run against a real Postgres (PGlite) with:
//   - the repository's own read/report policies for the list tables,
//     reconstructed from every migration before CP2 (last definition wins,
//     DROPs honoured - the same approach as tests/customListOwnership),
//   - the block/moderation helpers and report trigger read verbatim from
//     the migrations,
//   - the CP2 migration applied verbatim.
// Only table shapes and Supabase's auth plumbing are fixtures here.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const directory = new URL('../supabase/migrations/', import.meta.url);
const migrationName = '20261030120000_list_visibility_and_anonymous_discovery.sql';
const migration = readFileSync(new URL(migrationName, directory), 'utf8');

const POLICY_TABLES = [
  'custom_lists',
  'custom_list_items',
  'custom_list_types',
  'custom_list_statuses',
  'custom_list_item_images',
  'content_reports',
];

function priorPolicies() {
  const policies = new Map<string, string>();
  const tables = POLICY_TABLES.join('|');
  const pattern = new RegExp(
    `\\b(CREATE|DROP)\\s+POLICY\\s+(?:IF\\s+EXISTS\\s+)?"([^"]+)"\\s+ON\\s+public\\.(${tables})\\b[^;]*;`,
    'gi',
  );
  for (const file of readdirSync(directory).filter((n) => n.endsWith('.sql') && n < migrationName).sort()) {
    const sql = readFileSync(new URL(file, directory), 'utf8').replace(/--[^\n]*/g, '');
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
  if (start === -1) throw new Error(`Missing ${name} in ${file}`);
  return sql.slice(start, sql.indexOf('$$;', start) + 3);
}

// People
const ALICE = 'a0000000-0000-0000-0000-000000000001'; // public profile
const PRIYA = 'b0000000-0000-0000-0000-000000000002'; // private profile
const VIC = 'c0000000-0000-0000-0000-000000000003'; // signed-in stranger
const FERN = 'd0000000-0000-0000-0000-000000000004'; // approved follower of both
const BLAKE = 'e0000000-0000-0000-0000-000000000005'; // blocked by Priya and Alice
const MOD = 'f0000000-0000-0000-0000-000000000006'; // moderator

// Lists
const ALICE_PUBLIC = '11000000-0000-0000-0000-000000000001';
const ALICE_ONLY_ME = '11000000-0000-0000-0000-000000000002';
const PRIYA_FOLLOWERS = '22000000-0000-0000-0000-000000000001';
const PRIYA_ANON = '22000000-0000-0000-0000-000000000002';
const PRIYA_ONLY_ME = '22000000-0000-0000-0000-000000000003';
const PRIYA_EMPTY_ANON = '22000000-0000-0000-0000-000000000004';
const ANON_ITEM = '33000000-0000-0000-0000-000000000001';
const STATUS_TODO = '44000000-0000-0000-0000-000000000001';
const STATUS_DONE = '44000000-0000-0000-0000-000000000002';
const TYPE_NATURAL = '55000000-0000-0000-0000-000000000001';

// Content in the anonymous list that must never reach another user.
const SECRET_NOTE = 'Ask for Priya at the door';
const SECRET_ADDRESS = '742 Evergreen Terrace';
const SECRET_APPLE_ID = 'I1234567890ABCDEF';
const SECRET_PHOTO = 'custom-list-images/b0000000/secret.jpg';

let db: PGlite;

async function as<T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) {
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${user}'; SET request.jwt.claim.role = 'authenticated';`);
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec('RESET ROLE; RESET request.jwt.claim.sub; RESET request.jwt.claim.role;');
  }
}

const explore = (user: string, mode = 'all', query: string | null = null, limit = 50, offset = 0) =>
  as<{
    list_id: string | null;
    list_name: string;
    item_count: number;
    user_id: string | null;
    username: string | null;
    display_name: string | null;
    avatar_emoji: string | null;
    avatar_color: string | null;
    is_anonymous: boolean;
    discovery_token: string | null;
  }>(user, 'SELECT * FROM public.get_explore_lists($1, $2, $3, $4)', [mode, query, limit, offset]).then((r) => r.rows);

const tokenOf = async (listId: string) =>
  (await db.query<{ t: string }>('SELECT discovery_token::text AS t FROM custom_lists WHERE id = $1', [listId])).rows[0].t;

const discoverable = async (user: string, token: string) =>
  (await as<{ v: Record<string, unknown> | null }>(user, 'SELECT public.get_discoverable_list($1) AS v', [token])).rows[0].v;

async function seed() {
  await db.exec(`
    TRUNCATE content_reports, custom_list_item_images, custom_list_items, custom_list_types,
      custom_list_statuses, custom_lists, follows, blocked_users, moderation_hidden, user_roles, profiles;

    INSERT INTO profiles (user_id, is_private, username, display_name, avatar_emoji, avatar_color) VALUES
      ('${ALICE}', false, 'alice', 'Alice A', '🦊', '#fff'),
      ('${PRIYA}', true, 'priya', 'Priya P', '🐼', '#eee'),
      ('${VIC}', false, 'vic', 'Vic', '🐸', '#ddd'),
      ('${FERN}', false, 'fern', 'Fern', '🐨', '#ccc'),
      ('${BLAKE}', false, 'blake', 'Blake', '🦁', '#bbb'),
      ('${MOD}', false, 'mod', 'Mod', '🦉', '#aaa');
    INSERT INTO follows (follower_id, following_id, status) VALUES
      ('${FERN}', '${PRIYA}', 'accepted'), ('${FERN}', '${ALICE}', 'accepted'), ('${VIC}', '${PRIYA}', 'pending');
    INSERT INTO blocked_users (blocker_id, blocked_id) VALUES ('${PRIYA}', '${BLAKE}'), ('${ALICE}', '${BLAKE}');
    INSERT INTO user_roles (user_id, role) VALUES ('${MOD}', 'moderator');

    INSERT INTO custom_lists (id, user_id, name, icon, visibility) VALUES
      ('${ALICE_PUBLIC}', '${ALICE}', 'Alice coffee spots', '☕', 'profile'),
      ('${ALICE_ONLY_ME}', '${ALICE}', 'Alice diary', '📓', 'private'),
      ('${PRIYA_FOLLOWERS}', '${PRIYA}', 'Priya followers wines', '🍷', 'profile'),
      ('${PRIYA_ANON}', '${PRIYA}', 'Natural wine bars', '🍷', 'anonymous'),
      ('${PRIYA_ONLY_ME}', '${PRIYA}', 'Priya to-do', '✅', 'private'),
      ('${PRIYA_EMPTY_ANON}', '${PRIYA}', 'Brand new anonymous list', '🆕', 'anonymous');

    INSERT INTO custom_list_statuses (id, list_id, user_id, name, sort_order) VALUES
      ('${STATUS_TODO}', '${PRIYA_ANON}', '${PRIYA}', 'Want to try', 0),
      ('${STATUS_DONE}', '${PRIYA_ANON}', '${PRIYA}', 'Loved it', 1);
    INSERT INTO custom_list_types (id, list_id, user_id, name, color, icon, sort_order) VALUES
      ('${TYPE_NATURAL}', '${PRIYA_ANON}', '${PRIYA}', 'Natural', '#16a34a', '🌿', 0);

    INSERT INTO custom_list_items (id, list_id, user_id, name, notes, address, latitude, longitude,
                                   apple_place_id, rating, status_id, type_ids, price_level) VALUES
      ('${ANON_ITEM}', '${PRIYA_ANON}', '${PRIYA}', 'Bar Sauvage', '${SECRET_NOTE}', '${SECRET_ADDRESS}',
       41.9, -87.6, '${SECRET_APPLE_ID}', 9, '${STATUS_DONE}', ARRAY['${TYPE_NATURAL}']::uuid[], 3);
    INSERT INTO custom_list_items (list_id, user_id, name, status_id) VALUES
      ('${PRIYA_ANON}', '${PRIYA}', 'Cellar Door', '${STATUS_TODO}'),
      ('${ALICE_PUBLIC}', '${ALICE}', 'Bean Counter', NULL),
      ('${ALICE_ONLY_ME}', '${ALICE}', 'Secret diary entry', NULL),
      ('${PRIYA_FOLLOWERS}', '${PRIYA}', 'Followers-only Riesling', NULL),
      ('${PRIYA_ONLY_ME}', '${PRIYA}', 'Call the landlord', NULL);
    INSERT INTO custom_list_item_images (item_id, user_id, image_url) VALUES
      ('${ANON_ITEM}', '${PRIYA}', '${SECRET_PHOTO}');
  `);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;

    CREATE TABLE profiles (user_id uuid PRIMARY KEY, is_private boolean NOT NULL DEFAULT false,
      username text, display_name text, avatar_emoji text, avatar_color text);
    CREATE TABLE follows (follower_id uuid, following_id uuid, status text);
    CREATE TABLE blocked_users (blocker_id uuid, blocked_id uuid);
    CREATE TABLE moderation_hidden (content_type text, content_id uuid, owner_id uuid, reason text,
      PRIMARY KEY (content_type, content_id));
    CREATE TABLE user_roles (user_id uuid, role text);
    CREATE TABLE custom_lists (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      name text NOT NULL, icon text NOT NULL DEFAULT '📋', color text NOT NULL DEFAULT '#6366f1',
      show_rating boolean NOT NULL DEFAULT true, rating_mode text NOT NULL DEFAULT 'scale_10',
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE custom_list_statuses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      list_id uuid NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE, user_id uuid NOT NULL,
      name text NOT NULL, sort_order int);
    CREATE TABLE custom_list_types (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      list_id uuid NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE, user_id uuid NOT NULL,
      name text NOT NULL, color text, icon text, sort_order int);
    CREATE TABLE custom_list_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      list_id uuid NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE, user_id uuid NOT NULL,
      name text NOT NULL, notes text, address text, latitude float8, longitude float8, apple_place_id text,
      rating numeric, rating_manual numeric, price_level int, status_id uuid, type_ids uuid[] NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE TABLE custom_list_item_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id uuid NOT NULL, user_id uuid NOT NULL, image_url text NOT NULL);
    -- Only so moderation_content_owner (read verbatim) can run.
    CREATE TABLE restaurants (id uuid PRIMARY KEY, user_id uuid);
    CREATE TABLE recipes (id uuid PRIMARY KEY, user_id uuid);
    CREATE TABLE shared_list_items (id uuid PRIMARY KEY, added_by uuid);
    CREATE TABLE shared_list_item_comments (id uuid PRIMARY KEY, user_id uuid);
  `);
  // content_reports as the repository defines it (minus the auth.users FKs).
  const ugc = readFileSync(new URL('20260920120000_ugc_safety_report_and_block.sql', directory), 'utf8');
  const table = ugc.slice(ugc.indexOf('CREATE TABLE IF NOT EXISTS public.content_reports'));
  await db.exec(table.slice(0, table.indexOf(');') + 2).replace(/REFERENCES auth\.users\(id\) ON DELETE CASCADE/g, ''));
  await db.exec(`
    CREATE UNIQUE INDEX idx_content_reports_one_open_per_target
      ON public.content_reports (reporter_id, reported_user_id, COALESCE(content_id, '00000000-0000-0000-0000-000000000000'::uuid))
      WHERE status IN ('pending', 'reviewing');
    ALTER TABLE public.content_reports ADD COLUMN IF NOT EXISTS alerted_at TIMESTAMPTZ;
  `);

  await db.exec(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON custom_lists, custom_list_items, custom_list_types,
      custom_list_statuses, custom_list_item_images TO authenticated;
    GRANT SELECT, INSERT ON content_reports TO authenticated;
    GRANT SELECT ON profiles, follows TO authenticated;
    ALTER TABLE custom_lists ENABLE ROW LEVEL SECURITY;
    ALTER TABLE custom_list_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE custom_list_types ENABLE ROW LEVEL SECURITY;
    ALTER TABLE custom_list_statuses ENABLE ROW LEVEL SECURITY;
    ALTER TABLE custom_list_item_images ENABLE ROW LEVEL SECURITY;
    ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;
    SET check_function_bodies = off;
  `);
  // Helpers and the report trigger, verbatim.
  await db.exec(sourceFunction('20260920120000_ugc_safety_report_and_block.sql', 'is_blocked_pair'));
  await db.exec(sourceFunction('20261010120000_moderation_enforcement.sql', 'is_moderation_hidden'));
  await db.exec(sourceFunction('20261010120000_moderation_enforcement.sql', 'is_moderator'));
  await db.exec(sourceFunction('20260921012558_24d687b6-efa7-47db-a2db-dad68ea0aef8.sql', 'has_role'));
  await db.exec(sourceFunction('20261010120000_moderation_enforcement.sql', 'moderation_content_owner'));
  await db.exec(sourceFunction('20261010120000_moderation_enforcement.sql', 'content_reports_before_insert'));
  await db.exec(`CREATE TRIGGER content_reports_before_insert BEFORE INSERT ON public.content_reports
                 FOR EACH ROW EXECUTE FUNCTION public.content_reports_before_insert();`);
  await db.exec(priorPolicies());
  await db.exec(migration);
}, 60000);

beforeEach(seed);
afterAll(async () => {
  await db?.close();
});

describe('migration', () => {
  it('keeps every existing list at today\'s visibility ("profile")', async () => {
    const { rows } = await db.query<{ column_default: string; is_nullable: string }>(
      "SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name='custom_lists' AND column_name='visibility'",
    );
    expect(rows[0].column_default).toContain("'profile'");
    expect(rows[0].is_nullable).toBe('NO');
  });

  it('can be applied again without changing policies, functions or rows', async () => {
    const policies = 'SELECT tablename, policyname, cmd, permissive, qual, with_check FROM pg_policies ORDER BY 1, 2';
    const before = (await db.query(policies)).rows;
    const lists = (await db.query('SELECT id, visibility, discovery_token FROM custom_lists ORDER BY id')).rows;
    await db.exec(migration);
    expect((await db.query(policies)).rows).toEqual(before);
    expect((await db.query('SELECT id, visibility, discovery_token FROM custom_lists ORDER BY id')).rows).toEqual(lists);
  });

  it('leaves no broader read policy behind on any list table', async () => {
    const { rows } = await db.query<{ tablename: string; policyname: string }>(`
      SELECT tablename, policyname FROM pg_policies
      WHERE tablename IN ('custom_lists','custom_list_items','custom_list_types','custom_list_statuses','custom_list_item_images')
        AND cmd = 'SELECT' AND permissive = 'PERMISSIVE' ORDER BY 1, 2`);
    expect(rows).toEqual([
      { tablename: 'custom_list_item_images', policyname: 'Users can view photos of custom lists shared with them' },
      { tablename: 'custom_list_item_images', policyname: 'Users can view their own custom list item images' },
      { tablename: 'custom_list_items', policyname: 'Users can view items of custom lists shared with them' },
      { tablename: 'custom_list_items', policyname: 'Users can view their own custom list items' },
      { tablename: 'custom_list_statuses', policyname: 'Users can view statuses of custom lists shared with them' },
      { tablename: 'custom_list_statuses', policyname: 'Users can view their own list statuses' },
      { tablename: 'custom_list_types', policyname: 'Users can view their own list types' },
      { tablename: 'custom_list_types', policyname: 'Users can view types of custom lists shared with them' },
      { tablename: 'custom_lists', policyname: 'Users can view custom lists shared with them' },
      { tablename: 'custom_lists', policyname: 'Users can view their own custom lists' },
    ]);
  });
});

describe('1. public profile, list visible on profile', () => {
  it('is discoverable with its owner shown, and readable directly', async () => {
    const rows = await explore(VIC);
    expect(rows).toContainEqual(
      expect.objectContaining({ list_id: ALICE_PUBLIC, user_id: ALICE, username: 'alice', is_anonymous: false, discovery_token: null }),
    );
    expect((await as(VIC, 'SELECT id FROM custom_lists WHERE id=$1', [ALICE_PUBLIC])).rows).toHaveLength(1);
    expect((await as(VIC, 'SELECT id FROM custom_list_items WHERE list_id=$1', [ALICE_PUBLIC])).rows).toHaveLength(1);
  });

  it('keeps its signed-out share preview', async () => {
    const v = (await db.query<{ v: { name: string } | null }>("SELECT public.get_shared_preview('custom_list', $1) v", [ALICE_PUBLIC])).rows[0].v;
    expect(v?.name).toBe('Alice coffee spots');
  });
});

describe('2. public profile, list set to Only me', () => {
  it.each([VIC, FERN])('is invisible to %s everywhere', async (viewer) => {
    expect((await explore(viewer)).map((r) => r.list_name)).not.toContain('Alice diary');
    expect((await as(viewer, 'SELECT id FROM custom_lists WHERE id=$1', [ALICE_ONLY_ME])).rows).toHaveLength(0);
    expect((await as(viewer, 'SELECT id FROM custom_list_items WHERE list_id=$1', [ALICE_ONLY_ME])).rows).toHaveLength(0);
    expect((await as<{ v: boolean }>(viewer, 'SELECT public.can_view_custom_list($1) v', [ALICE_ONLY_ME])).rows[0].v).toBe(false);
  });

  it('has no share preview', async () => {
    const v = (await db.query<{ v: unknown }>("SELECT public.get_shared_preview('custom_list', $1) v", [ALICE_ONLY_ME])).rows[0].v;
    expect(v).toBeNull();
  });
});

describe('3. private profile without anonymous consent', () => {
  it('is not discoverable or readable by a stranger (pending follow request included)', async () => {
    const names = (await explore(VIC)).map((r) => r.list_name);
    expect(names).not.toContain('Priya followers wines');
    expect(names).not.toContain('Priya to-do');
    expect((await as(VIC, 'SELECT id FROM custom_lists WHERE user_id=$1', [PRIYA])).rows).toHaveLength(0);
    expect((await as(VIC, 'SELECT id FROM custom_list_items WHERE user_id=$1', [PRIYA])).rows).toHaveLength(0);
  });
});

describe('4. private profile with anonymous consent', () => {
  it('appears in discovery with no owner fields at all', async () => {
    const row = (await explore(VIC)).find((r) => r.list_name === 'Natural wine bars');
    expect(row).toEqual({
      list_id: null,
      list_name: 'Natural wine bars',
      item_count: 2,
      user_id: null,
      username: null,
      display_name: null,
      avatar_emoji: null,
      avatar_color: null,
      is_anonymous: true,
      discovery_token: await tokenOf(PRIYA_ANON),
      list_icon: '🍷',
    });
  });

  it('is never readable through the tables, even by id', async () => {
    for (const table of ['custom_lists', 'custom_list_statuses', 'custom_list_types']) {
      const col = table === 'custom_lists' ? 'id' : 'list_id';
      expect((await as(VIC, `SELECT * FROM ${table} WHERE ${col}=$1`, [PRIYA_ANON])).rows).toHaveLength(0);
    }
    expect((await as(VIC, 'SELECT * FROM custom_list_items WHERE id=$1', [ANON_ITEM])).rows).toHaveLength(0);
  });

  it('opens by token with exactly the allowlisted fields', async () => {
    const v = await discoverable(VIC, await tokenOf(PRIYA_ANON));
    expect(Object.keys(v!).sort()).toEqual(['icon', 'is_owner', 'items', 'rating_mode', 'statuses', 'title', 'token', 'types']);
    expect(v).toMatchObject({
      title: 'Natural wine bars',
      is_owner: false,
      statuses: ['Want to try', 'Loved it'],
      types: [{ name: 'Natural', icon: '🌿', color: '#16a34a' }],
      items: [
        { name: 'Cellar Door', status: 'Want to try', types: [], rating: null },
        { name: 'Bar Sauvage', status: 'Loved it', types: ['Natural'], rating: 9 },
      ],
    });
    for (const item of v!.items as Record<string, unknown>[]) {
      expect(Object.keys(item).sort()).toEqual(['name', 'rating', 'status', 'types']);
    }
  });

  it('never carries the owner, notes, address, coordinates, place ID, photos or row IDs', async () => {
    const text = JSON.stringify([await discoverable(VIC, await tokenOf(PRIYA_ANON)), await explore(VIC)]);
    for (const secret of [PRIYA, 'priya', 'Priya P', '🐼', SECRET_NOTE, SECRET_ADDRESS, SECRET_APPLE_ID, SECRET_PHOTO,
      '41.9', '-87.6', PRIYA_ANON, ANON_ITEM, STATUS_DONE, TYPE_NATURAL]) {
      expect(text).not.toContain(secret);
    }
  });

  it('is shown anonymously to followers too, and never in the Friends view', async () => {
    const all = (await explore(FERN)).find((r) => r.list_name === 'Natural wine bars');
    expect(all).toMatchObject({ is_anonymous: true, user_id: null, list_id: null });
    expect((await explore(FERN, 'friends')).map((r) => r.list_name)).not.toContain('Natural wine bars');
    expect((await as(FERN, 'SELECT id FROM custom_lists WHERE id=$1', [PRIYA_ANON])).rows).toHaveLength(0);
  });

  it('has no signed-out share preview', async () => {
    const v = (await db.query<{ v: unknown }>("SELECT public.get_shared_preview('custom_list', $1) v", [PRIYA_ANON])).rows[0].v;
    expect(v).toBeNull();
  });
});

describe('5. anonymous discovery revoked', () => {
  it.each(['profile', 'private'])('takes effect immediately when changed to %s', async (next) => {
    const token = await tokenOf(PRIYA_ANON);
    expect(await discoverable(VIC, token)).not.toBeNull();
    await as(PRIYA, 'UPDATE custom_lists SET visibility=$1 WHERE id=$2', [next, PRIYA_ANON]);
    expect(await discoverable(VIC, token)).toBeNull();
    expect((await explore(VIC)).map((r) => r.list_name)).not.toContain('Natural wine bars');
    expect((await as<{ r: string }>(VIC, "SELECT public.report_discoverable_list($1, 'spam') r", [token])).rows[0].r).toBe('not_found');
    expect(await tokenOf(PRIYA_ANON)).not.toBe(token);
  });

  it('gets a fresh token when re-enabled, so the old link stays dead', async () => {
    const first = await tokenOf(PRIYA_ANON);
    await as(PRIYA, "UPDATE custom_lists SET visibility='private' WHERE id=$1", [PRIYA_ANON]);
    await as(PRIYA, "UPDATE custom_lists SET visibility='anonymous' WHERE id=$1", [PRIYA_ANON]);
    const second = await tokenOf(PRIYA_ANON);
    expect(second).not.toBe(first);
    expect(await discoverable(VIC, first)).toBeNull();
    expect(await discoverable(VIC, second)).not.toBeNull();
  });

  it('does not let the owner choose or keep a token by hand', async () => {
    const token = await tokenOf(PRIYA_ANON);
    await as(PRIYA, "UPDATE custom_lists SET discovery_token='99999999-9999-9999-9999-999999999999', name='Renamed' WHERE id=$1", [PRIYA_ANON]);
    expect(await tokenOf(PRIYA_ANON)).toBe(token);
  });
});

describe('6. owner viewing their own lists', () => {
  it('sees every list, identified, whatever its visibility', async () => {
    const mine = (await explore(PRIYA)).filter((r) => r.user_id === PRIYA).map((r) => r.list_name).sort();
    expect(mine).toEqual(['Natural wine bars', 'Priya followers wines', 'Priya to-do']);
    // Five including the empty anonymous list, which discovery leaves out.
    expect((await as(PRIYA, 'SELECT id FROM custom_lists')).rows).toHaveLength(5);
  });

  it('can preview the anonymous view - identical to what others get - before and after opting in', async () => {
    const preview = (await as<{ v: Record<string, unknown> }>(PRIYA, 'SELECT public.get_list_discovery_preview($1) v', [PRIYA_ANON])).rows[0].v;
    const others = await discoverable(VIC, await tokenOf(PRIYA_ANON));
    const { visibility, ...rest } = preview;
    expect(visibility).toBe('anonymous');
    expect({ ...rest, is_owner: false }).toEqual(others);
    const before = (await as<{ v: Record<string, unknown> }>(PRIYA, 'SELECT public.get_list_discovery_preview($1) v', [PRIYA_ONLY_ME])).rows[0].v;
    expect(before).toMatchObject({ title: 'Priya to-do', visibility: 'private', items: [{ name: 'Call the landlord' }] });
  });

  it('cannot be previewed by anyone else', async () => {
    for (const user of [VIC, FERN, MOD]) {
      expect((await as<{ v: unknown }>(user, 'SELECT public.get_list_discovery_preview($1) v', [PRIYA_ANON])).rows[0].v).toBeNull();
    }
  });
});

describe('7. approved followers under the existing rules', () => {
  it('see a private profile\'s profile-visible list, identified, in both views', async () => {
    for (const mode of ['all', 'friends']) {
      expect(await explore(FERN, mode)).toContainEqual(
        expect.objectContaining({ list_id: PRIYA_FOLLOWERS, user_id: PRIYA, is_anonymous: false }),
      );
    }
    expect((await as(FERN, 'SELECT name FROM custom_list_items WHERE list_id=$1', [PRIYA_FOLLOWERS])).rows).toEqual([
      { name: 'Followers-only Riesling' },
    ]);
  });

  it('do not see the owner\'s Only me list', async () => {
    expect((await as(FERN, 'SELECT id FROM custom_lists WHERE id=$1', [PRIYA_ONLY_ME])).rows).toHaveLength(0);
  });
});

describe('8. blocked users', () => {
  it('cannot discover, open, read or report anything from the blocker', async () => {
    const token = await tokenOf(PRIYA_ANON);
    expect((await explore(BLAKE)).map((r) => r.list_name)).toEqual([]);
    expect(await discoverable(BLAKE, token)).toBeNull();
    expect((await as(BLAKE, 'SELECT id FROM custom_lists WHERE id=$1', [ALICE_PUBLIC])).rows).toHaveLength(0);
    expect((await as<{ r: string }>(BLAKE, "SELECT public.report_discoverable_list($1, 'spam') r", [token])).rows[0].r).toBe('not_found');
  });
});

describe('9. direct access to anonymous details', () => {
  it('gives nothing for a guessed list id through any function', async () => {
    expect((await as<{ v: unknown }>(VIC, "SELECT public.get_shared_preview('custom_list', $1) v", [PRIYA_ANON])).rows[0].v).toBeNull();
    expect((await as<{ v: boolean }>(VIC, 'SELECT public.can_view_custom_list($1) v', [PRIYA_ANON])).rows[0].v).toBe(false);
    expect(await discoverable(VIC, PRIYA_ANON)).toBeNull();
  });

  it('does not let clients call the internal builder', async () => {
    await expect(as(VIC, 'SELECT public.custom_list_anonymous_view($1)', [PRIYA_ANON])).rejects.toMatchObject({ code: '42501' });
  });

  it('returns nothing for unknown tokens, signed-out callers or moderation-hidden lists', async () => {
    expect(await discoverable(VIC, '99999999-9999-9999-9999-999999999999')).toBeNull();
    const token = await tokenOf(PRIYA_ANON);
    expect((await db.query<{ v: unknown }>('SELECT public.get_discoverable_list($1) v', [token])).rows[0].v).toBeNull();
    await db.exec(`INSERT INTO moderation_hidden VALUES ('custom_list', '${PRIYA_ANON}', '${PRIYA}', 'auto_reports')`);
    expect(await discoverable(VIC, token)).toBeNull();
    expect((await explore(VIC)).map((r) => r.list_name)).not.toContain('Natural wine bars');
  });

  it('hides moderation-hidden items inside an anonymous list', async () => {
    await db.exec(`INSERT INTO moderation_hidden VALUES ('custom_list_item', '${ANON_ITEM}', '${PRIYA}', 'moderator')`);
    const v = await discoverable(VIC, await tokenOf(PRIYA_ANON));
    expect((v!.items as { name: string }[]).map((i) => i.name)).toEqual(['Cellar Door']);
  });
});

describe('10. search never reveals private content', () => {
  it.each([
    ['Alice diary', 'title of an Only me list'],
    ['Secret diary', 'item in an Only me list'],
    ['landlord', 'item in a private profile\'s Only me list'],
    ['Riesling', 'item in a followers-only list'],
    ['Evergreen', 'address inside an anonymous list'],
    ['Ask for Priya', 'note inside an anonymous list'],
    ['priya', 'owner username of an anonymous list'],
  ])('finds nothing for %s (%s)', async (query) => {
    expect(await explore(VIC, 'all', query)).toEqual([]);
  });

  it('finds an anonymous list by its title, an item name or a type - still without its owner', async () => {
    for (const query of ['wine bars', 'Sauvage', 'natural']) {
      const rows = await explore(VIC, 'all', query);
      expect(rows.map((r) => r.list_name)).toEqual(['Natural wine bars']);
      expect(rows[0]).toMatchObject({ user_id: null, username: null, list_id: null });
    }
  });

  it('treats % and _ as literal characters', async () => {
    expect(await explore(VIC, 'all', '%')).toEqual([]);
    expect(await explore(VIC, 'all', '_')).toEqual([]);
  });
});

describe('11. photos and notes stay out of anonymous previews', () => {
  it('keeps photo rows unreadable and absent from the view', async () => {
    expect((await as(VIC, 'SELECT * FROM custom_list_item_images')).rows).toHaveLength(0);
    expect((await as(FERN, 'SELECT * FROM custom_list_item_images')).rows).toHaveLength(0);
    expect((await as(PRIYA, 'SELECT * FROM custom_list_item_images')).rows).toHaveLength(1);
    expect(JSON.stringify(await discoverable(VIC, await tokenOf(PRIYA_ANON)))).not.toMatch(/image|photo|notes/i);
  });

  it('lets someone report an anonymous list without ever reading the owner back', async () => {
    const token = await tokenOf(PRIYA_ANON);
    expect((await as<{ r: string }>(VIC, "SELECT public.report_discoverable_list($1, 'spam', 'rude') r", [token])).rows[0].r).toBe('reported');
    expect((await as<{ r: string }>(VIC, "SELECT public.report_discoverable_list($1, 'spam') r", [token])).rows[0].r).toBe('already_reported');
    expect((await as(VIC, 'SELECT * FROM content_reports')).rows).toEqual([]);
    const stored = (await db.query('SELECT reporter_id, reported_user_id, content_type, content_id, via_anonymous FROM content_reports')).rows;
    expect(stored).toEqual([{ reporter_id: VIC, reported_user_id: PRIYA, content_type: 'custom_list', content_id: PRIYA_ANON, via_anonymous: true }]);
    expect((await as(MOD, 'SELECT id FROM content_reports')).rows).toHaveLength(1);
    expect((await as<{ r: string }>(PRIYA, "SELECT public.report_discoverable_list($1, 'spam') r", [token])).rows[0].r).toBe('own_list');
  });
});

describe('12. identifying titles and items', () => {
  it('shows the owner precisely the text others will see (the server does not try to "anonymise" it)', async () => {
    await as(PRIYA, "UPDATE custom_lists SET name='Priya''s wedding venues' WHERE id=$1", [PRIYA_ANON]);
    const preview = (await as<{ v: { title: string } }>(PRIYA, 'SELECT public.get_list_discovery_preview($1) v', [PRIYA_ANON])).rows[0].v;
    const others = await discoverable(VIC, await tokenOf(PRIYA_ANON));
    expect(preview.title).toBe("Priya's wedding venues");
    expect(others!.title).toBe(preview.title);
  });
});

describe('13. switching the account between public and private', () => {
  it('public -> private: profile-visible lists become followers-only', async () => {
    await db.exec(`UPDATE profiles SET is_private=true WHERE user_id='${ALICE}'`);
    expect((await as(VIC, 'SELECT id FROM custom_lists WHERE id=$1', [ALICE_PUBLIC])).rows).toHaveLength(0);
    expect((await explore(VIC)).map((r) => r.list_name)).not.toContain('Alice coffee spots');
    expect((await as(FERN, 'SELECT id FROM custom_lists WHERE id=$1', [ALICE_PUBLIC])).rows).toHaveLength(1);
  });

  it('private -> public: anonymous and Only me lists stay exactly as they were', async () => {
    await db.exec(`UPDATE profiles SET is_private=false WHERE user_id='${PRIYA}'`);
    expect((await as(VIC, 'SELECT id FROM custom_lists WHERE id IN ($1, $2)', [PRIYA_ANON, PRIYA_ONLY_ME])).rows).toHaveLength(0);
    expect((await explore(VIC)).find((r) => r.list_name === 'Natural wine bars')).toMatchObject({ is_anonymous: true, user_id: null });
    // Today's rule, unchanged: lists left at "profile" follow the profile.
    expect((await as(VIC, 'SELECT id FROM custom_lists WHERE id=$1', [PRIYA_FOLLOWERS])).rows).toHaveLength(1);
  });
});

describe('14. regressions in discovery', () => {
  it('still answers the old one-argument call', async () => {
    const rows = (await as<{ list_name: string }>(VIC, "SELECT list_name FROM public.get_explore_lists('all')")).rows;
    expect(rows.map((r) => r.list_name).sort()).toEqual(['Alice coffee spots', 'Natural wine bars']);
  });

  it('leaves out lists with no items (a brand-new anonymous list appears once it has one)', async () => {
    expect((await explore(VIC)).map((r) => r.list_name)).not.toContain('Brand new anonymous list');
    await as(PRIYA, "INSERT INTO custom_list_items (list_id, user_id, name) VALUES ($1, $2, 'First')", [PRIYA_EMPTY_ANON, PRIYA]);
    expect((await explore(VIC)).map((r) => r.list_name)).toContain('Brand new anonymous list');
  });

  it('pages without repeating or skipping a list', async () => {
    for (let i = 0; i < 7; i++) {
      await db.exec(`
        WITH l AS (INSERT INTO custom_lists (user_id, name) VALUES ('${ALICE}', 'Page list ${i}') RETURNING id)
        INSERT INTO custom_list_items (list_id, user_id, name) SELECT id, '${ALICE}', 'x' FROM l;`);
    }
    const all = await explore(VIC, 'all', null, 100, 0);
    const paged = [...(await explore(VIC, 'all', null, 4, 0)), ...(await explore(VIC, 'all', null, 4, 4)), ...(await explore(VIC, 'all', null, 4, 8))];
    const key = (r: { list_id: string | null; discovery_token: string | null }) => r.list_id ?? r.discovery_token;
    expect(paged.map(key)).toEqual(all.map(key));
    expect(new Set(paged.map(key)).size).toBe(paged.length);
    expect(await explore(VIC, 'all', null, 1000, 0)).toHaveLength(all.length);
  });

  it('still lets owners create, edit and delete their own lists and items', async () => {
    const res = await as(PRIYA, `
      WITH l AS (INSERT INTO custom_lists (user_id, name, visibility) VALUES ('${PRIYA}', 'New', 'private') RETURNING id)
      SELECT id FROM l`);
    const id = (res.rows[0] as { id: string }).id;
    await as(PRIYA, "UPDATE custom_lists SET name='Renamed', visibility='anonymous' WHERE id=$1", [id]);
    await as(PRIYA, "INSERT INTO custom_list_items (list_id, user_id, name) VALUES ($1, $2, 'thing')", [id, PRIYA]);
    expect((await as(PRIYA, 'SELECT name FROM custom_list_items WHERE list_id=$1', [id])).rows).toEqual([{ name: 'thing' }]);
    await as(PRIYA, 'DELETE FROM custom_lists WHERE id=$1', [id]);
    expect((await db.query('SELECT id FROM custom_lists WHERE id=$1', [id])).rows).toHaveLength(0);
  });

  it('rejects an unknown visibility value', async () => {
    await expect(as(PRIYA, "UPDATE custom_lists SET visibility='everyone' WHERE id=$1", [PRIYA_ANON])).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps the restrictive block policy on lists', async () => {
    expect((await as(BLAKE, 'SELECT id FROM custom_lists')).rows).toHaveLength(0);
  });
});
