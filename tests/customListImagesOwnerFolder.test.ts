// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The custom-list-images upload policy, before and after
 * 20261109180000_custom_list_images_owner_folder.sql, run as ordinary
 * `authenticated` users on a real Postgres (PGlite). Every storage.objects
 * policy preceding the migration is reconstructed from the repository's
 * migrations (last definition wins, DROPs honoured); only the auth/storage
 * plumbing is a fixture. This is the repository's policy state, not a read
 * of the live catalog.
 */
const directory = new URL('../supabase/migrations/', import.meta.url);
const migrationName = '20261109180000_custom_list_images_owner_folder.sql';
const migration = readFileSync(new URL(migrationName, directory), 'utf8');

function priorStoragePolicies() {
  const policies = new Map<string, string>();
  for (const file of readdirSync(directory).filter((n) => n.endsWith('.sql') && n < migrationName).sort()) {
    const sql = readFileSync(new URL(file, directory), 'utf8').replace(/--[^\n]*/g, '');
    const pattern = /\b(CREATE|DROP)\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+storage\.objects\b[^;]*;/gi;
    for (const m of sql.matchAll(pattern)) {
      if (m[1].toUpperCase() === 'DROP') policies.delete(m[2]);
      else policies.set(m[2], m[0]);
    }
  }
  return [...policies.values()].join('\n');
}

const OWNER = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';
let db: PGlite;
let gapReproduced = false;

async function as(user: string, sql: string) {
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${user}';`);
  try {
    return await db.query<{ n: number }>(sql);
  } finally {
    await db.exec('RESET ROLE');
  }
}

async function upload(user: string, bucket: string, name: string) {
  try {
    await as(user, `INSERT INTO storage.objects(bucket_id, name, owner) VALUES ('${bucket}', '${name}', '${user}')`);
    return true;
  } catch {
    return false;
  }
}

const count = async (user: string, bucket: string, name: string) =>
  (await as(user, `SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id='${bucket}' AND name='${name}'`)).rows[0].n;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
    DECLARE _parts text[];
    BEGIN
      SELECT string_to_array(name, '/') INTO _parts;
      RETURN _parts[1:array_length(_parts, 1) - 1];
    END $$;
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid);
    CREATE TABLE public.follows(follower_id uuid, following_id uuid, status text);
    GRANT USAGE ON SCHEMA auth, storage TO authenticated, anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, anon;
    GRANT SELECT ON public.follows TO authenticated;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  `);
  await db.exec(priorStoragePolicies());

  // The gap, before the migration: another account writes into OWNER's folder.
  gapReproduced = await upload(OTHER, 'custom-list-images', `${OWNER}/item-1/planted.jpg`);
  await db.exec(`DELETE FROM storage.objects`);

  await db.exec(migration);
  await db.exec(migration); // safe to re-run
  await db.exec(`INSERT INTO storage.objects(bucket_id, name, owner) VALUES ('custom-list-images', '${OWNER}/item-1/mine.jpg', '${OWNER}')`);
});

describe('custom-list-images uploads after the migration', () => {
  it('the gap existed before it (cross-owner upload was accepted)', () => {
    expect(gapReproduced).toBe(true);
  });

  it('an owner can still upload into their own folder', async () => {
    expect(await upload(OWNER, 'custom-list-images', `${OWNER}/item-1/new.jpg`)).toBe(true);
    expect(await count(OWNER, 'custom-list-images', `${OWNER}/item-1/new.jpg`)).toBe(1);
  });

  it('another account cannot upload into the owner’s folder', async () => {
    expect(await upload(OTHER, 'custom-list-images', `${OWNER}/item-1/planted.jpg`)).toBe(false);
    expect(await count(OWNER, 'custom-list-images', `${OWNER}/item-1/planted.jpg`)).toBe(0);
  });

  it('a file outside any user folder is refused', async () => {
    expect(await upload(OWNER, 'custom-list-images', 'loose.jpg')).toBe(false);
  });

  it('reading stays owner-only and existing objects are untouched', async () => {
    expect(await count(OWNER, 'custom-list-images', `${OWNER}/item-1/mine.jpg`)).toBe(1);
    expect(await count(OTHER, 'custom-list-images', `${OWNER}/item-1/mine.jpg`)).toBe(0);
  });

  it('another account still cannot delete or replace the owner’s files', async () => {
    await as(OTHER, `DELETE FROM storage.objects WHERE name = '${OWNER}/item-1/mine.jpg'`);
    await as(OTHER, `UPDATE storage.objects SET name = 'x' WHERE name = '${OWNER}/item-1/mine.jpg'`);
    expect(await count(OWNER, 'custom-list-images', `${OWNER}/item-1/mine.jpg`)).toBe(1);
  });

  it('restaurant-images rules are unchanged', async () => {
    expect(await upload(OWNER, 'restaurant-images', `${OWNER}/r1/a.jpg`)).toBe(true);
    expect(await upload(OTHER, 'restaurant-images', `${OWNER}/r1/b.jpg`)).toBe(false);
  });
});
