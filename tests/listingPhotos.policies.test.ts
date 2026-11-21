// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The fix must not widen photo access. These checks run the repository's own
 * storage.objects and restaurant_images policies - reconstructed from every
 * migration, last definition wins, DROPs honoured - against a real Postgres
 * (PGlite). Only the table shapes and auth/storage plumbing are fixtures.
 * This is the repository's policy state, not a read of the live catalog.
 */
const directory = new URL('../supabase/migrations/', import.meta.url);

function finalPolicies(target: RegExp) {
  const policies = new Map<string, string>();
  for (const file of readdirSync(directory).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(new URL(file, directory), 'utf8').replace(/--[^\n]*/g, '');
    const pattern = /\b(CREATE|DROP)\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+([a-z_]+\.[a-z_]+)\b[^;]*;/gi;
    for (const m of sql.matchAll(pattern)) {
      if (!target.test(m[3])) continue;
      const key = `${m[3]}:${m[2]}`;
      if (m[1].toUpperCase() === 'DROP') policies.delete(key);
      else policies.set(key, m[0]);
    }
  }
  return [...policies.values()];
}

const OWNER = '00000000-0000-0000-0000-000000000001';
const FOLLOWER = '00000000-0000-0000-0000-000000000002';
const PENDING = '00000000-0000-0000-0000-000000000003';
const STRANGER = '00000000-0000-0000-0000-000000000004';
const RESTAURANT = '10000000-0000-0000-0000-000000000001';
let db: PGlite;

async function as(user: string | null, sql: string) {
  await db.exec(user ? `SET ROLE authenticated; SET request.jwt.claim.sub = '${user}';` : `SET ROLE anon; SET request.jwt.claim.sub = '';`);
  try {
    return await db.query<{ n: number }>(sql);
  } finally {
    await db.exec('RESET ROLE');
  }
}

async function canSee(user: string | null, bucket: string, name: string) {
  const { rows } = await as(user, `SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id='${bucket}' AND name='${name}'`);
  return rows[0].n === 1;
}

async function canUpload(user: string, bucket: string, name: string) {
  try {
    await as(user, `INSERT INTO storage.objects(bucket_id, name) VALUES ('${bucket}', '${name}')`);
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    -- Same definition as Supabase's storage.foldername.
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
    DECLARE _parts text[];
    BEGIN
      SELECT string_to_array(name, '/') INTO _parts;
      RETURN _parts[1:array_length(_parts, 1) - 1];
    END $$;
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
    CREATE TABLE public.follows(follower_id uuid, following_id uuid, status text);
    CREATE TABLE public.restaurant_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      restaurant_id uuid, user_id uuid NOT NULL, image_url text NOT NULL);
    GRANT USAGE ON SCHEMA auth, storage TO authenticated, anon;
    GRANT SELECT, INSERT, DELETE ON storage.objects, public.restaurant_images TO authenticated, anon;
    GRANT SELECT ON public.follows TO authenticated, anon;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.restaurant_images ENABLE ROW LEVEL SECURITY;
  `);
  const policies = finalPolicies(/^(storage\.objects|public\.restaurant_images)$/i);
  expect(policies.length).toBeGreaterThan(5);
  await db.exec(policies.join('\n'));
  await db.exec(`
    INSERT INTO public.follows VALUES ('${FOLLOWER}', '${OWNER}', 'accepted'), ('${PENDING}', '${OWNER}', 'pending');
    INSERT INTO storage.objects(bucket_id, name) VALUES
      ('restaurant-images', '${OWNER}/${RESTAURANT}/a.jpg'),
      ('custom-list-images', '${OWNER}/item/b.jpg');
    INSERT INTO public.restaurant_images(restaurant_id, user_id, image_url)
      VALUES ('${RESTAURANT}', '${OWNER}', 'https://x/storage/v1/object/public/restaurant-images/${OWNER}/${RESTAURANT}/a.jpg');
  `);
});

describe('restaurant-images bucket stays private', () => {
  const name = `${OWNER}/${RESTAURANT}/a.jpg`;
  it('the owner can read their photo (#8)', async () => expect(await canSee(OWNER, 'restaurant-images', name)).toBe(true));
  it('an accepted follower can read it', async () => expect(await canSee(FOLLOWER, 'restaurant-images', name)).toBe(true));
  it('a pending follower cannot (#9)', async () => expect(await canSee(PENDING, 'restaurant-images', name)).toBe(false));
  it('a stranger cannot (#9)', async () => expect(await canSee(STRANGER, 'restaurant-images', name)).toBe(false));
  it('a signed-out visitor cannot (#9)', async () => expect(await canSee(null, 'restaurant-images', name)).toBe(false));
  it('uploads are limited to your own folder', async () => {
    expect(await canUpload(OWNER, 'restaurant-images', `${OWNER}/${RESTAURANT}/new.jpg`)).toBe(true);
    expect(await canUpload(STRANGER, 'restaurant-images', `${OWNER}/${RESTAURANT}/evil.jpg`)).toBe(false);
  });
  it('only the owner can remove an object (the orphan clean-up path)', async () => {
    await as(STRANGER, `DELETE FROM storage.objects WHERE name='${name}'`);
    expect(await canSee(OWNER, 'restaurant-images', name)).toBe(true);
  });
});

describe('custom-list-images bucket is owner-only', () => {
  const name = `${OWNER}/item/b.jpg`;
  it('the owner can read it (#8)', async () => expect(await canSee(OWNER, 'custom-list-images', name)).toBe(true));
  it('followers and strangers cannot (#9)', async () => {
    expect(await canSee(FOLLOWER, 'custom-list-images', name)).toBe(false);
    expect(await canSee(STRANGER, 'custom-list-images', name)).toBe(false);
  });
});

describe('restaurant_images rows follow the same rule as the objects', () => {
  const count = async (user: string) =>
    (await as(user, `SELECT count(*)::int AS n FROM public.restaurant_images`)).rows[0].n;
  it('owner and accepted follower see the record; others do not', async () => {
    expect(await count(OWNER)).toBe(1);
    expect(await count(FOLLOWER)).toBe(1);
    expect(await count(PENDING)).toBe(0);
    expect(await count(STRANGER)).toBe(0);
  });
});

describe('idempotent attachment insert (client-chosen id) under the real policies', () => {
  const id = '30000000-0000-0000-0000-000000000001';
  const insert = `INSERT INTO public.restaurant_images(id, restaurant_id, user_id, image_url)
    VALUES ('${id}', '${RESTAURANT}', '${OWNER}', 'https://x/storage/v1/object/public/restaurant-images/${OWNER}/${RESTAURANT}/n.jpg')`;
  const lookup = `SELECT count(*)::int AS n FROM public.restaurant_images WHERE id = '${id}'`;

  it('the owner may choose the id; a repeat is refused by the primary key (23505), not duplicated', async () => {
    await as(OWNER, insert);
    await expect(as(OWNER, insert)).rejects.toMatchObject({ code: '23505' });
    expect((await as(OWNER, lookup)).rows[0].n).toBe(1);
  });

  it('the reconcile lookup by id reveals nothing to anyone else', async () => {
    expect((await as(STRANGER, lookup)).rows[0].n).toBe(0);
    expect((await as(PENDING, lookup)).rows[0].n).toBe(0);
  });
});
