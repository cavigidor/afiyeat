// Shared by the schema tests (E0-a) and the baseline builder (E0-b).
// Reads migration files either from a directory or from a git ref, never from a database.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
export const REPO = path.resolve(here, '..', '..');
export const REPAIRS = JSON.parse(readFileSync(path.join(here, 'repairs.json'), 'utf8'));
export const STUBS = readFileSync(path.join(here, 'supabase-stubs.sql'), 'utf8');

/** List migration files at a git ref (e.g. origin/main) or in a directory. Returns [{name, sql}] sorted. */
export function loadMigrations({ ref, dir } = {}) {
  if (dir) {
    return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
      .map((name) => ({ name, sql: readFileSync(path.join(dir, name), 'utf8') }));
  }
  const names = execFileSync('git', ['-C', REPO, 'ls-tree', '--name-only', ref, 'supabase/migrations/'], { encoding: 'utf8' })
    .trim().split('\n').filter((f) => f.endsWith('.sql')).sort();
  return names.map((p) => ({ name: path.basename(p), sql: execFileSync('git', ['-C', REPO, 'show', `${ref}:${p}`], { encoding: 'utf8', maxBuffer: 1 << 26 }) }));
}

/** Apply the named mechanical rules to one file's SQL. Pure text rewriting; see repairs.json. */
export function repair(sql, rules) {
  let out = sql;
  for (const rule of rules) {
    if (rule === 'R1') out = out.replace(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/gi, 'CREATE TABLE IF NOT EXISTS ');
    else if (rule === 'R2') out = out.replace(/CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/gi, (m, u) => `CREATE ${u ?? ''}INDEX IF NOT EXISTS `);
    else if (rule === 'R3') out = out.replace(/CREATE\s+POLICY\s+("[^"]+")\s+ON\s+([\w.]+)/gi, (m, n, t) => `DROP POLICY IF EXISTS ${n} ON ${t};\n${m}`);
    else if (rule === 'R4') out = out.replace(/ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/gi, 'ADD COLUMN IF NOT EXISTS ');
    else if (rule === 'R5') out = out.replace(/CREATE\s+TRIGGER\s+(\w+)([\s\S]*?)\bON\s+([\w.]+)/gi, (m, n, mid, t) => `DROP TRIGGER IF EXISTS ${n} ON ${t};\n${m}`);
    else if (rule.startsWith('R6:')) {
      const fn = rule.slice(3);
      out = `DO $repair$ DECLARE s text; BEGIN FOR s IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '${fn}' LOOP EXECUTE 'DROP FUNCTION ' || s; END LOOP; END $repair$;\n` + out;
    } else throw new Error(`unknown repair rule ${rule}`);
  }
  return out;
}

/** The baseline sequence: main's files, each repaired only if listed in repairs.json. */
export function baselineFiles({ ref = 'origin/main', dir } = {}) {
  return loadMigrations({ ref, dir }).map((m) => {
    const rules = REPAIRS[m.name];
    return { ...m, rules: rules ?? [], sql: rules ? repair(m.sql, rules) : m.sql };
  });
}

/** Files present at `ref` but not on main: the pending stack migrations, in timestamp order. */
export function pendingFiles({ ref, mainRef = 'origin/main' }) {
  const onMain = new Set(loadMigrations({ ref: mainRef }).map((m) => m.name));
  return loadMigrations({ ref }).filter((m) => !onMain.has(m.name));
}

/** Resolve a git ref to its full 40-character commit SHA (pins every input to an exact commit). */
export function resolveRef(ref) {
  const sha = execFileSync('git', ['-C', REPO, 'rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`cannot resolve ${ref} to a commit`);
  return sha;
}

/** Apply one migration's SQL in-process. pg_cron / pg_net are stubbed, so their CREATE EXTENSION lines are dropped here only. */
export async function applyInProcess(db, name, sql) {
  const cleaned = sql.replace(/CREATE EXTENSION IF NOT EXISTS pg_(cron|net)[^;]*;/gi, '');
  try { await db.exec(cleaned); } catch (e) { throw new Error(`${name}: ${e.message}`); }
}

/** Build an in-process Postgres: Supabase stand-ins, then baseline, then `extra` files in order. Throws on the first error. */
export async function buildDatabase({ mainRef = 'origin/main', stackRef, extra = [], include } = {}) {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const { uuid_ossp } = await import('@electric-sql/pglite/contrib/uuid_ossp');
  const { unaccent } = await import('@electric-sql/pglite/contrib/unaccent');
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm, uuid_ossp, unaccent } });
  await db.exec(STUBS);
  const apply = (name, sql) => applyInProcess(db, name, sql);
  for (const f of baselineFiles({ ref: mainRef })) await apply(f.name, f.sql);
  if (stackRef) for (const f of pendingFiles({ ref: stackRef, mainRef })) if (!include || include.includes(f.name)) await apply(f.name, f.sql);
  for (const f of extra) await apply(path.basename(f), readFileSync(f, 'utf8'));
  return db;
}
