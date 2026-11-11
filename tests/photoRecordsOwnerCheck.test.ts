// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Two-account regression tests for 20261111120000_photo_records_owner_check.
 *
 * The restaurant_images and custom_list_item_images policies are rebuilt from
 * the repository's migrations (last definition wins, DROPs honoured) on a
 * real Postgres (PGlite), once without and once with the new migration, and
 * exercised as ordinary `authenticated` users:
 *   A - owns a place and a list item;
 *   B - another account; A and B follow each other (so B can read A's ids);
 *   V - follows both A and B.
 * Parent tables use fixture read policies (own rows, or an accepted
 * follower) - the worst case for the insert check, since B can see A's ids.
 * This is the repository's policy state, not a read of the live catalog.
 */
const directory = new URL('../supabase/migrations/', import.meta.url);
const FIX = '20261111120000_photo_records_owner_check.sql';
const HAS_LIST_VISIBILITY = existsSync(new URL('20261030120000_list_visibility_and_anonymous_discovery.sql', directory));

function photoPolicies(includeFix: boolean) {
  const policies = new Map<string, string>();
  const files = readdirSync(directory)
    .filter((n) => n.endsWith('.sql') && (includeFix || n !== FIX))
    .sort();
  for (const file of files) {
    const sql = readFileSync(new URL(file, directory), 'utf8').replace(/--[^\n]*/g, '');
    const pattern = /\b(CREATE|DROP)\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+(public\.(?:restaurant_images|custom_list_item_images))\b[^;]*;/gi;
    for (const m of sql.matchAll(pattern)) {
      const key = `${m[3]}:${m[2]}`;
      if (m[1].toUpperCase() === 'DROP') policies.delete(key);
      else policies.set(key, m[0]);
    }
  }
  return [...policies.values()].join('\n');
}

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const V = '00000000-0000-0000-0000-00000000000f';
const PLACE_A = '10000000-0000-0000-0000-00000000000a';
const PLACE_B = '10000000-0000-0000-0000-00000000000b';
const LIST_A = '20000000-0000-0000-0000-00000000000a';
const ITEM_A = '30000000-0000-0000-0000-00000000000a';
const LIST_B = '20000000-0000-0000-0000-00000000000b';
const ITEM_B = '30000000-0000-0000-0000-00000000000b';
const url = (owner: string, file: string) => `https://x/storage/v1/object/public/restaurant-images/${owner}/${file}`;

async function database(includeFix: boolean) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;

    CREATE TABLE public.follows(follower_id uuid, following_id uuid, status text);
    CREATE TABLE public.profiles(user_id uuid PRIMARY KEY, is_private boolean DEFAULT false);
    CREATE TABLE public.restaurants(id uuid PRIMARY KEY, user_id uuid NOT NULL, name text);
    CREATE TABLE public.custom_lists(id uuid PRIMARY KEY, user_id uuid NOT NULL);
    CREATE TABLE public.custom_list_items(id uuid PRIMARY KEY, list_id uuid NOT NULL, user_id uuid NOT NULL);
    CREATE TABLE public.restaurant_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      restaurant_id uuid NOT NULL REFERENCES public.restaurants(id), user_id uuid NOT NULL, image_url text NOT NULL);
    CREATE TABLE public.custom_list_item_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id uuid NOT NULL REFERENCES public.custom_list_items(id), user_id uuid NOT NULL, image_url text NOT NULL);

    -- Fixture read rules for parents: own rows, or an accepted follower.
    CREATE FUNCTION public.fixture_can_read(owner uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT owner = auth.uid() OR EXISTS (SELECT 1 FROM public.follows f
        WHERE f.follower_id = auth.uid() AND f.following_id = owner AND f.status = 'accepted')
    $$;
    -- Stand-in for the list-visibility helper (only referenced once 20261030120000 exists).
    CREATE FUNCTION public.can_view_custom_list(p_list_id uuid, p_author uuid DEFAULT NULL) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT EXISTS (SELECT 1 FROM public.custom_lists l WHERE l.id = p_list_id
        AND (p_author IS NULL OR p_author = l.user_id) AND public.fixture_can_read(l.user_id))
    $$;
    ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.custom_list_items ENABLE ROW LEVEL SECURITY;
    CREATE POLICY r ON public.restaurants FOR SELECT USING (public.fixture_can_read(user_id));
    CREATE POLICY i ON public.custom_list_items FOR SELECT USING (public.fixture_can_read(user_id));

    GRANT SELECT ON public.follows, public.profiles, public.restaurants, public.custom_lists, public.custom_list_items
      TO authenticated, anon;
    GRANT SELECT, INSERT, DELETE ON public.restaurant_images, public.custom_list_item_images TO authenticated, anon;
    ALTER TABLE public.restaurant_images ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.custom_list_item_images ENABLE ROW LEVEL SECURITY;

    INSERT INTO public.profiles VALUES ('${A}', false), ('${B}', false), ('${V}', false);
    INSERT INTO public.follows VALUES
      ('${A}', '${B}', 'accepted'), ('${B}', '${A}', 'accepted'),
      ('${V}', '${A}', 'accepted'), ('${V}', '${B}', 'accepted');
    INSERT INTO public.restaurants VALUES ('${PLACE_A}', '${A}', 'Bistro'), ('${PLACE_B}', '${B}', 'Cafe');
    INSERT INTO public.custom_lists VALUES ('${LIST_A}', '${A}'), ('${LIST_B}', '${B}');
    INSERT INTO public.custom_list_items VALUES ('${ITEM_A}', '${LIST_A}', '${A}'), ('${ITEM_B}', '${LIST_B}', '${B}');
    -- A legitimate photo on A's place, and one planted earlier by B.
    INSERT INTO public.restaurant_images(id, restaurant_id, user_id, image_url) VALUES
      ('40000000-0000-0000-0000-00000000000a', '${PLACE_A}', '${A}', '${url(A, 'own.jpg')}'),
      ('40000000-0000-0000-0000-0000000000bb', '${PLACE_A}', '${B}', '${url(B, 'planted-earlier.jpg')}');
  `);
  await db.exec(photoPolicies(includeFix));
  return db;
}

async function as<T = { n: number }>(db: PGlite, user: string, sql: string) {
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${user}';`);
  try {
    return await db.query<T>(sql);
  } finally {
    await db.exec('RESET ROLE');
  }
}

async function tryInsert(db: PGlite, user: string, sql: string) {
  try {
    await as(db, user, sql);
    return true;
  } catch {
    return false;
  }
}

const placePhoto = (owner: string, place: string, file: string) =>
  `INSERT INTO public.restaurant_images(restaurant_id, user_id, image_url) VALUES ('${place}', '${owner}', '${url(owner, file)}')`;
const itemPhoto = (owner: string, item: string, file: string) =>
  `INSERT INTO public.custom_list_item_images(item_id, user_id, image_url) VALUES ('${item}', '${owner}', 'https://x/storage/v1/object/public/custom-list-images/${owner}/${file}')`;
const photosOn = async (db: PGlite, viewer: string, place: string) =>
  (await as<{ image_url: string }>(db, viewer, `SELECT image_url FROM public.restaurant_images WHERE restaurant_id = '${place}' ORDER BY image_url`)).rows.map((r) => r.image_url.split('/').pop());
const itemPhotos = async (db: PGlite, viewer: string, item: string) =>
  (await as<{ image_url: string }>(db, viewer, `SELECT image_url FROM public.custom_list_item_images WHERE item_id = '${item}' ORDER BY image_url`)).rows.map((r) => r.image_url.split('/').pop());

let before: PGlite;
let after: PGlite;
beforeAll(async () => {
  [before, after] = await Promise.all([database(false), database(true)]);
});

describe('without the fix (the reported gap)', () => {
  it('B can attach a photo record to A’s place', async () => {
    expect(await tryInsert(before, B, placePhoto(B, PLACE_A, 'planted-now.jpg'))).toBe(true);
  });

  it('it shows up in A’s own place for A, and for a follower of both', async () => {
    expect(await photosOn(before, A, PLACE_A)).toContain('planted-now.jpg');
    expect(await photosOn(before, V, PLACE_A)).toContain('planted-now.jpg');
  });

  it('A cannot remove it from their own place', async () => {
    await as(before, A, `DELETE FROM public.restaurant_images WHERE image_url LIKE '%planted-now.jpg'`);
    expect(await photosOn(before, A, PLACE_A)).toContain('planted-now.jpg');
  });

  it('B can attach a photo record to A’s list item', async () => {
    expect(await tryInsert(before, B, itemPhoto(B, ITEM_A, 'planted-item.jpg'))).toBe(true);
    // Visible to A on the current schema; already hidden once list visibility (PR #8) is applied.
    expect((await itemPhotos(before, A, ITEM_A)).includes('planted-item.jpg')).toBe(!HAS_LIST_VISIBILITY);
  });
});

describe('with the fix', () => {
  it('the owner can still add photos to their own place and list item', async () => {
    expect(await tryInsert(after, A, placePhoto(A, PLACE_A, 'new-own.jpg'))).toBe(true);
    expect(await tryInsert(after, A, itemPhoto(A, ITEM_A, 'new-own-item.jpg'))).toBe(true);
    expect(await tryInsert(after, B, placePhoto(B, PLACE_B, 'b-own.jpg'))).toBe(true);
    expect(await tryInsert(after, B, itemPhoto(B, ITEM_B, 'b-own-item.jpg'))).toBe(true);
  });

  it('B cannot attach a photo record to A’s place or list item, even though B can read their ids', async () => {
    expect((await as(after, B, `SELECT count(*)::int AS n FROM public.restaurants WHERE id = '${PLACE_A}'`)).rows[0].n).toBe(1);
    expect(await tryInsert(after, B, placePhoto(B, PLACE_A, 'blocked.jpg'))).toBe(false);
    expect(await tryInsert(after, B, itemPhoto(B, ITEM_A, 'blocked-item.jpg'))).toBe(false);
  });

  it('forging the owner’s user id is still refused', async () => {
    expect(await tryInsert(after, B, placePhoto(A, PLACE_A, 'forged.jpg'))).toBe(false);
    expect(await tryInsert(after, B, itemPhoto(A, ITEM_A, 'forged-item.jpg'))).toBe(false);
  });

  it('a record planted before the fix is hidden from A and followers, without being deleted', async () => {
    expect(await photosOn(after, A, PLACE_A)).not.toContain('planted-earlier.jpg');
    expect(await photosOn(after, V, PLACE_A)).not.toContain('planted-earlier.jpg');
    const all = await after.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.restaurant_images WHERE image_url LIKE '%planted-earlier.jpg'`);
    expect(all.rows[0].n).toBe(1);
  });

  it('legitimate photos stay visible to the owner and followers', async () => {
    expect(await photosOn(after, A, PLACE_A)).toEqual(expect.arrayContaining(['own.jpg', 'new-own.jpg']));
    expect(await photosOn(after, V, PLACE_A)).toEqual(expect.arrayContaining(['own.jpg', 'new-own.jpg']));
    expect(await photosOn(after, V, PLACE_B)).toContain('b-own.jpg');
    expect(await itemPhotos(after, A, ITEM_A)).toContain('new-own-item.jpg');
  });

  it('a stranger still sees none of it', async () => {
    const S = '00000000-0000-0000-0000-000000000099';
    expect(await photosOn(after, S, PLACE_A)).toEqual([]);
  });
});
