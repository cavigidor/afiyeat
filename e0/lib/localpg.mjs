// A real, multi-connection Postgres for tests that PGlite (one connection) cannot run.
// Local only: connects through a Unix socket directory, never over a network, and refuses
// any other host. Start the server with concurrency/start-local-pg.sh.
import pg from 'pg';
import { baselineFiles, pendingFiles, STUBS } from './migrations.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const SOCKET_DIR = process.env.E0_LOCAL_PG_SOCKET ?? '/tmp/e0pg';
export const PORT = Number(process.env.E0_LOCAL_PG_PORT ?? 54329);

function assertLocal() {
  if (!SOCKET_DIR.startsWith('/')) throw new Error(`E0_LOCAL_PG_SOCKET must be an absolute socket directory, got ${SOCKET_DIR}`);
}
export function client(database) {
  assertLocal();
  return new pg.Client({ host: SOCKET_DIR, port: PORT, user: 'postgres', database });
}

/** Create a fresh database: stubs, repaired main, the stack's pending migrations, then `extra` files. */
export async function buildLocalDatabase({ name, mainRef = 'origin/main', stackRef, extra = [] }) {
  if (!/^e0_[a-z0-9_]{1,40}$/.test(name)) throw new Error('local database names must start with e0_');
  const admin = client('postgres');
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const db = client(name);
  await db.connect();
  // Roles are cluster-wide: create them once, tolerate existing ones.
  const stubs = STUBS.replace(/CREATE ROLE (\w+)([^;]*);/g, (m, r, rest) =>
    `DO $$ BEGIN CREATE ROLE ${r}${rest}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await db.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm;
                  CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE EXTENSION IF NOT EXISTS unaccent;`);
  await db.query(stubs);
  const apply = async (n, sql) => {
    const cleaned = sql.replace(/CREATE EXTENSION IF NOT EXISTS pg_(cron|net)[^;]*;/gi, '');
    try { await db.query(cleaned); } catch (e) { throw new Error(`${n}: ${e.message}`); }
  };
  for (const f of baselineFiles({ ref: mainRef })) await apply(f.name, f.sql);
  if (stackRef) for (const f of pendingFiles({ ref: stackRef, mainRef })) await apply(f.name, f.sql);
  for (const f of extra) await apply(path.basename(f), readFileSync(f, 'utf8'));
  await db.end();
}

/** A connection that acts as a signed-in user, with row-level security in force. */
export async function userConnection(name, uid) {
  const c = client(name);
  await c.connect();
  // A regression must fail, not hang: a call that waits on a lock for more than 5 s errors (55P03).
  await c.query(`SET lock_timeout = '5s'`);
  await c.query(`SET ROLE authenticated`);
  await c.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  return c;
}
