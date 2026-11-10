// @vitest-environment node
//
// CP4 data-coverage and privacy tests for get_discovery_places, run against
// a real Postgres (PGlite) with:
//   - the block / moderation helpers read verbatim from the migrations,
//   - today's get_explore_places read verbatim (the "before"),
//   - the CP4 migration applied verbatim (the "after").
// Only table shapes and Supabase's auth plumbing are fixtures here.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { classifyPlace } from '@/lib/placeClassification';

const directory = new URL('../supabase/migrations/', import.meta.url);
const migration = readFileSync(new URL('20261109120000_discovery_places.sql', directory), 'utf8');

function sourceFunction(file: string, name: string) {
  const sql = readFileSync(new URL(file, directory), 'utf8');
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start === -1) throw new Error(`Missing ${name} in ${file}`);
  return sql.slice(start, sql.indexOf('$$;', start) + 3);
}

// People
const ME = 'a0000000-0000-0000-0000-000000000001'; // the viewer, public
const ALICE = 'a0000000-0000-0000-0000-000000000002'; // public
const PRIYA = 'a0000000-0000-0000-0000-000000000003'; // private, ME follows (accepted)
const PAT = 'a0000000-0000-0000-0000-000000000004'; // private, nobody follows
const BLAKE = 'a0000000-0000-0000-0000-000000000005'; // public, blocked by ME
const MOLLY = 'a0000000-0000-0000-0000-000000000006'; // public, restricted by moderation
const FERN = 'a0000000-0000-0000-0000-000000000007'; // public
const PATS_FRIEND = 'a0000000-0000-0000-0000-000000000008'; // follows PAT (accepted)

// Folders (My Restaurants types)
const ALICE_CAFE = 'f0000000-0000-0000-0000-000000000001';
const ALICE_BAR = 'f0000000-0000-0000-0000-000000000002';
const ALICE_DATE = 'f0000000-0000-0000-0000-000000000003';
const PRIYA_CAFE = 'f0000000-0000-0000-0000-000000000004';
const PAT_BAR = 'f0000000-0000-0000-0000-000000000005';
const PAT_SECRET = 'f0000000-0000-0000-0000-000000000006';
const BLAKE_BAR = 'f0000000-0000-0000-0000-000000000007';

const SECRET_TYPE = 'Pat secret type';

let db: PGlite;
let n = 0;
const rid = () => `e0000000-0000-0000-0000-${String(++n).padStart(12, '0')}`;

async function as<T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) {
  await db.exec(
    user
      ? `SET ROLE authenticated; SET request.jwt.claim.sub = '${user}';`
      : `SET ROLE anon; SET request.jwt.claim.sub = '';`,
  );
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec('RESET ROLE; RESET request.jwt.claim.sub;');
  }
}

interface DiscoveryRow {
  place_id: string;
  name: string;
  address: string | null;
  category: string | null;
  avg_rating: number | null;
  rating_count: number;
  contributor_count: number;
  saved_count: number;
  type_names: string[];
  apple_place_id: string | null;
}

const discovery = async (user: string, mode = 'all') =>
  (await as<DiscoveryRow>(user, 'SELECT * FROM public.get_discovery_places($1) ORDER BY place_id', [mode])).rows;
const explore = async (user: string, mode = 'all') =>
  (await as<{ place_id: string; category: string | null }>(user, 'SELECT * FROM public.get_explore_places($1) ORDER BY place_id', [mode])).rows;
const byId = (rows: DiscoveryRow[], id: string) => rows.find((r) => r.place_id === id);

async function save(
  user: string,
  name: string,
  opts: {
    apple?: string;
    address?: string;
    status?: 'went_to' | 'to_go';
    rating?: number;
    category?: string;
    folders?: string[];
  } = {},
) {
  await db.query(
    `INSERT INTO restaurants (id, user_id, name, apple_place_id, address, status, rating, category, folder_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid[])`,
    [rid(), user, name, opts.apple ?? null, opts.address ?? null, opts.status ?? 'went_to', opts.rating ?? null,
      opts.category ?? null, opts.folders ?? []],
  );
}

async function seed() {
  await db.exec(`
    TRUNCATE restaurants, folders, place_cache, follows, blocked_users, moderation_hidden, profiles;
    INSERT INTO profiles (user_id, is_private) VALUES
      ('${ME}', false), ('${ALICE}', false), ('${PRIYA}', true), ('${PAT}', true),
      ('${BLAKE}', false), ('${MOLLY}', false), ('${FERN}', false), ('${PATS_FRIEND}', false);
    INSERT INTO follows (follower_id, following_id, status) VALUES
      ('${ME}', '${PRIYA}', 'accepted'), ('${ME}', '${ALICE}', 'accepted'), ('${PATS_FRIEND}', '${PAT}', 'accepted'),
      ('${ME}', '${PAT}', 'pending');
    INSERT INTO blocked_users (blocker_id, blocked_id) VALUES ('${ME}', '${BLAKE}');
    INSERT INTO moderation_hidden (content_type, content_id, owner_id, reason) VALUES ('user', '${MOLLY}', '${MOLLY}', 'restricted');
    INSERT INTO folders (id, user_id, name) VALUES
      ('${ALICE_CAFE}', '${ALICE}', 'Cafe'), ('${ALICE_BAR}', '${ALICE}', 'Bar'), ('${ALICE_DATE}', '${ALICE}', 'Date Night'),
      ('${PRIYA_CAFE}', '${PRIYA}', 'Cafe'), ('${PAT_BAR}', '${PAT}', 'Bar'), ('${PAT_SECRET}', '${PAT}', '${SECRET_TYPE}'),
      ('${BLAKE_BAR}', '${BLAKE}', 'Bar');
    INSERT INTO place_cache (apple_place_id, name, address, latitude, longitude, category, expires_at) VALUES
      ('A2', 'Kumiko', '630 W Lake St, Chicago, IL 60661, United States', 41.88, -87.64, 'Nightlife', now() + interval '3 days'),
      ('A7', 'Old Cache Name', 'Somewhere', 41.9, -87.6, 'Cafe', now() - interval '1 day');
  `);

  // A1: a café several people have been to. Pat (private) tagged it "Bar"
  // and a secret type; Fern saved it twice (visited and want-to-go).
  await save(ALICE, 'Blue Bottle', { apple: 'A1', rating: 8, category: 'Cafe', folders: [ALICE_CAFE, ALICE_DATE] });
  await save(PAT, 'Blue Bottle', { apple: 'A1', rating: 6, category: 'Cafe', folders: [PAT_BAR, PAT_SECRET] });
  await save(FERN, 'Blue Bottle', { apple: 'A1', rating: 10, category: 'Cafe' });
  await save(FERN, 'Blue Bottle (again)', { apple: 'A1', status: 'to_go', category: 'Cafe' });
  // A2: only on Alice's want-to-go list, typed "Bar", no stored category.
  await save(ALICE, 'Kumiko', { apple: 'A2', status: 'to_go', folders: [ALICE_BAR] });
  // A3: only on private Pat's want-to-go list.
  await save(PAT, 'Pats wish', { apple: 'A3', status: 'to_go', category: 'Restaurant' });
  // A4: only on Priya's want-to-go list (private, but ME follows her).
  await save(PRIYA, 'Sawada Coffee', { apple: 'A4', status: 'to_go', folders: [PRIYA_CAFE] });
  // A5: blocked person's visit. A6: restricted person's visit.
  await save(BLAKE, 'Blocked spot', { apple: 'A5', category: 'Restaurant', folders: [BLAKE_BAR] });
  await save(MOLLY, 'Moderated spot', { apple: 'A6', category: 'Restaurant' });
  // A7: cache expired - fall back to the stored category.
  await save(ALICE, 'Lula Cafe', { apple: 'A7', category: 'Restaurant' });
  // Two different venues that share a name.
  await save(ALICE, 'Starbucks', { apple: 'S1', category: 'Cafe' });
  await save(FERN, 'Starbucks', { apple: 'S2', category: 'Cafe' });
  // A book typed into My Restaurants with no location - not a place.
  await save(ALICE, 'Coffee Table Design');
  // Alice's row pointing at Pat's secret folder id (only the owner's own folders count).
  await save(ALICE, 'Injected', { apple: 'A8', category: 'Restaurant', folders: [PAT_SECRET] });
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    CREATE TABLE profiles (user_id uuid PRIMARY KEY, is_private boolean NOT NULL DEFAULT false);
    CREATE TABLE follows (follower_id uuid, following_id uuid, status text);
    CREATE TABLE blocked_users (blocker_id uuid, blocked_id uuid);
    CREATE TABLE moderation_hidden (content_type text, content_id uuid, owner_id uuid, reason text,
      PRIMARY KEY (content_type, content_id));
    CREATE TABLE folders (id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL);
    CREATE TABLE restaurants (id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL,
      address text, latitude float8, longitude float8, category text, price_level int, rating int,
      status text NOT NULL DEFAULT 'to_go' CHECK (status IN ('to_go', 'went_to')),
      folder_id uuid, folder_ids uuid[] NOT NULL DEFAULT '{}', place_id text, apple_place_id text, notes text,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE TABLE place_cache (apple_place_id text PRIMARY KEY, name text, address text, latitude float8,
      longitude float8, category text, country_code text, fetched_at timestamptz DEFAULT now(),
      expires_at timestamptz NOT NULL);
    SET check_function_bodies = off;
  `);
  await db.exec(sourceFunction('20260921012415_81126387-eca4-41d7-8c45-3730f3654ece.sql', 'is_blocked_pair'));
  await db.exec(sourceFunction('20261010120000_moderation_enforcement.sql', 'is_moderation_hidden'));
  await db.exec(sourceFunction('20261010120000_moderation_enforcement.sql', 'get_explore_places'));
  await db.exec('GRANT EXECUTE ON FUNCTION public.get_explore_places(text) TO authenticated;');
  await db.exec(migration);
}, 60000);

beforeEach(seed);
afterAll(async () => {
  await db?.close();
});

describe('migration', () => {
  it('adds one function and leaves get_explore_places untouched', async () => {
    const statements = migration.replace(/--[^\n]*/g, '');
    expect(statements).not.toMatch(/get_explore_places/);
    expect(statements).not.toMatch(/\b(ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    const { rows } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'get_discovery_places'",
    );
    expect(rows[0].n).toBe(1);
  });

  it('can be applied again', async () => {
    const before = await discovery(ME);
    await db.exec(migration);
    expect(await discovery(ME)).toEqual(before);
  });

  it('never reads custom lists or two-person shared lists (blocked on CP2 / private)', async () => {
    const { rows } = await db.query<{ src: string }>(
      "SELECT prosrc AS src FROM pg_proc WHERE proname = 'get_discovery_places'",
    );
    expect(rows[0].src).not.toMatch(/custom_list|shared_list/);
    expect(rows[0].src).not.toMatch(/\bnotes\b/);
  });

  it('is not callable signed out', async () => {
    await expect(as(null, "SELECT * FROM public.get_discovery_places('all')")).rejects.toThrow(/permission denied/);
  });
});

describe('coverage: before vs after', () => {
  it("before: get_explore_places only sees visits, so want-to-go places never reach discovery", async () => {
    const ids = (await explore(ME)).map((r) => r.place_id);
    expect(ids).toEqual(['A1', 'A7', 'A8', 'S1', 'S2']);
  });

  it('after: visits plus visible want-to-go saves', async () => {
    const ids = (await discovery(ME)).map((r) => r.place_id);
    expect(ids).toEqual(['A1', 'A2', 'A4', 'A7', 'A8', 'S1', 'S2']);
  });
});

describe('saved-to-visit vs visited', () => {
  it('counts only visits as contributors and ratings', async () => {
    const a1 = byId(await discovery(ME), 'A1')!;
    expect(a1.contributor_count).toBe(3); // Alice, Pat (anonymously, as today), Fern once
    expect(a1.rating_count).toBe(3);
    expect(a1.avg_rating).toBe(8);
    // Fern also has a want-to-go row, but has been - not counted as a save.
    expect(a1.saved_count).toBe(0);
  });

  it('a want-to-go-only place has no visits and no rating', async () => {
    const a2 = byId(await discovery(ME), 'A2')!;
    expect(a2).toMatchObject({ contributor_count: 0, rating_count: 0, avg_rating: null, saved_count: 1 });
  });

  it("includes a private account's want-to-go only for its approved followers", async () => {
    expect(byId(await discovery(ME), 'A4')?.saved_count).toBe(1); // ME follows Priya
    expect(byId(await discovery(FERN), 'A4')).toBeUndefined();
    expect(byId(await discovery(ME, 'friends'), 'A4')?.saved_count).toBe(1);
  });

  it("never surfaces a private account's wish list to strangers, not even as a count", async () => {
    for (const viewer of [ME, FERN, ALICE]) {
      expect(byId(await discovery(viewer), 'A3')).toBeUndefined();
    }
    expect(byId(await discovery(PAT), 'A3')?.saved_count).toBe(1); // their own
  });
});

describe('types (Level 2 evidence) and privacy', () => {
  it("returns only visible people's types", async () => {
    expect(byId(await discovery(ME), 'A1')?.type_names).toEqual(['Cafe', 'Date Night']);
    expect(byId(await discovery(PATS_FRIEND), 'A1')?.type_names).toEqual(['Bar', 'Cafe', 'Date Night', SECRET_TYPE]);
  });

  it("a private account's type can't move a place into a category for others", async () => {
    const forMe = byId(await discovery(ME), 'A1')!;
    const forPatsFriend = byId(await discovery(PATS_FRIEND), 'A1')!;
    const cats = (r: DiscoveryRow) =>
      classifyPlace({ name: r.name, venueCategory: r.category, placeTypes: r.type_names }).categories;
    expect(cats(forMe)).toEqual(['coffee']);
    expect(cats(forPatsFriend)).toEqual(['coffee', 'drinks']);
  });

  it('never returns the secret type name to anyone else', async () => {
    for (const viewer of [ME, FERN, ALICE]) {
      expect(JSON.stringify(await discovery(viewer))).not.toContain(SECRET_TYPE);
    }
  });

  it("ignores folder ids that belong to someone else", async () => {
    expect(byId(await discovery(ME), 'A8')?.type_names).toEqual([]);
  });
});

describe('blocks and moderation', () => {
  it('leaves out blocked and restricted people entirely', async () => {
    const ids = (await discovery(ME)).map((r) => r.place_id);
    expect(ids).not.toContain('A5');
    expect(ids).not.toContain('A6');
    expect(JSON.stringify(await discovery(ME))).not.toContain('Blocked spot');
  });

  it('a single hidden save drops out', async () => {
    const { rows } = await db.query<{ id: string }>("SELECT id FROM restaurants WHERE apple_place_id = 'S1'");
    await db.query("INSERT INTO moderation_hidden (content_type, content_id, owner_id) VALUES ('restaurant', $1, $2)", [rows[0].id, ALICE]);
    expect(byId(await discovery(ME), 'S1')).toBeUndefined();
  });
});

describe('identity and deduplication', () => {
  it('one row per place, however many people or rows saved it', async () => {
    const rows = await discovery(ME);
    expect(rows.filter((r) => r.place_id === 'A1')).toHaveLength(1);
  });

  it('never merges different venues that share a name', async () => {
    const rows = (await discovery(ME)).filter((r) => r.name === 'Starbucks');
    expect(rows.map((r) => r.place_id)).toEqual(['S1', 'S2']);
  });

  it('leaves out records with no location (not a place)', async () => {
    expect(JSON.stringify(await discovery(ME))).not.toContain('Coffee Table Design');
  });
});

describe('venue category', () => {
  it("prefers Apple's fresh cached category over the stored one", async () => {
    expect(byId(await discovery(ME), 'A2')?.category).toBe('Nightlife');
  });

  it('falls back to the stored category once the cache has expired', async () => {
    const a7 = byId(await discovery(ME), 'A7')!;
    expect(a7.category).toBe('Restaurant');
    expect(a7.name).toBe('Lula Cafe');
  });
});
