// Minimal copy of e0/lib/migrations.mjs, so this security draft stands alone (it does not depend on the
// Lists V2 branches). Reads migration files from git refs only; builds an in-process Postgres (PGlite).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(here, '..', '..', '..');
const REPAIRS = JSON.parse(readFileSync(path.join(here, 'repairs.json'), 'utf8'));
const STUBS = readFileSync(path.join(here, 'supabase-stubs.sql'), 'utf8');

function load(ref) {
  const names = execFileSync('git', ['-C', REPO, 'ls-tree', '--name-only', ref, 'supabase/migrations/'], { encoding: 'utf8' })
    .trim().split('\n').filter((f) => f.endsWith('.sql')).sort();
  return names.map((p) => ({ name: path.basename(p), sql: execFileSync('git', ['-C', REPO, 'show', `${ref}:${p}`], { encoding: 'utf8', maxBuffer: 1 << 26 }) }));
}
function repair(sql, rules) {
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

/** main's migrations (repaired per repairs.json), then the stack's extra files if stackRef is given. */
export async function buildDatabase({ mainRef = 'origin/main', stackRef } = {}) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(STUBS);
  const apply = async (name, sql) => {
    try { await db.exec(sql.replace(/CREATE EXTENSION IF NOT EXISTS pg_(cron|net)[^;]*;/gi, '')); } catch (e) { throw new Error(`${name}: ${e.message}`); }
  };
  const main = load(mainRef);
  for (const m of main) await apply(m.name, REPAIRS[m.name] ? repair(m.sql, REPAIRS[m.name]) : m.sql);
  if (stackRef) {
    const onMain = new Set(main.map((m) => m.name));
    for (const m of load(stackRef).filter((x) => !onMain.has(x.name))) await apply(m.name, m.sql);
  }
  return db;
}
