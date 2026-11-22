// An in-process Postgres (PGlite) holding every migration in supabase/migrations, replayed in order, the
// way production has them now. Ported from PR #24 (e0/lib/migrations.mjs). Never connects anywhere.
//
// Nine early files on main don't replay on an empty database (Lovable re-ran them by hand); the mechanical
// rewrites in migration-repairs.json make them idempotent. Every other file is applied exactly as committed.
import { readFileSync, readdirSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const STUBS = readFileSync(new URL('./supabase-stubs.sql', import.meta.url), 'utf8');
const REPAIRS: Record<string, string[]> = JSON.parse(readFileSync(new URL('./migration-repairs.json', import.meta.url), 'utf8'));

function repair(sql: string, rules: string[]) {
  let out = sql;
  for (const rule of rules) {
    if (rule === 'R1') out = out.replace(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/gi, 'CREATE TABLE IF NOT EXISTS ');
    else if (rule === 'R2') out = out.replace(/CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/gi, (_m, u) => `CREATE ${u ?? ''}INDEX IF NOT EXISTS `);
    else if (rule === 'R3') out = out.replace(/CREATE\s+POLICY\s+("[^"]+")\s+ON\s+([\w.]+)/gi, (m, n, t) => `DROP POLICY IF EXISTS ${n} ON ${t};\n${m}`);
    else if (rule === 'R4') out = out.replace(/ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/gi, 'ADD COLUMN IF NOT EXISTS ');
    else if (rule === 'R5') out = out.replace(/CREATE\s+TRIGGER\s+(\w+)([\s\S]*?)\bON\s+([\w.]+)/gi, (m, n, _mid, t) => `DROP TRIGGER IF EXISTS ${n} ON ${t};\n${m}`);
    else if (rule.startsWith('R6:')) {
      const fn = rule.slice(3);
      out = `DO $repair$ DECLARE s text; BEGIN FOR s IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '${fn}' LOOP EXECUTE 'DROP FUNCTION ' || s; END LOOP; END $repair$;\n` + out;
    } else throw new Error(`unknown repair rule ${rule}`);
  }
  return out;
}

/** Every migration in the repository, in order, on a fresh in-process database. */
export async function replayMigrations(): Promise<PGlite> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const { uuid_ossp } = await import('@electric-sql/pglite/contrib/uuid_ossp');
  const { unaccent } = await import('@electric-sql/pglite/contrib/unaccent');
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm, uuid_ossp, unaccent } });
  await db.exec(STUBS);
  for (const name of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const raw = readFileSync(new URL(name, MIGRATIONS), 'utf8');
    const sql = (REPAIRS[name] ? repair(raw, REPAIRS[name]) : raw).replace(/CREATE EXTENSION IF NOT EXISTS pg_(cron|net)[^;]*;/gi, '');
    try { await db.exec(sql); } catch (e) { throw new Error(`${name}: ${(e as Error).message}`); }
  }
  return db;
}
