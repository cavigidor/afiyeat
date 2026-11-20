// Local Postgres for the compatibility lab. Never connects anywhere but the
// local cluster it starts itself (127.0.0.1, a private data directory).
//
//   node db.mjs start
//   node db.mjs build <dbname> --main <sha> [--pending <sha>]   # replay migrations into a NEW database
//   node db.mjs apply-pending <dbname> --main <sha> --stack <sha> # apply the pending (not-on-main) files
//   node db.mjs stop
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const LAB = path.dirname(new URL(import.meta.url).pathname);
export const REPO = process.env.AFIYEAT_REPO ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
export const PG_BIN = process.env.PG_BIN ?? '/usr/lib/postgresql/16/bin';
export const PGDATA = path.join(LAB, '..', 'pgdata');
export const PGPORT = Number(process.env.LAB_PGPORT ?? 54329);
const REPAIRS = JSON.parse(readFileSync(path.join(LAB, '..', 'repairs.json'), 'utf8'));

const asPg = (cmd, args) => {
  // initdb/pg_ctl refuse to run as root; run them as the postgres OS user.
  const r = process.getuid?.() === 0
    ? spawnSync('su', ['postgres', '-c', [cmd, ...args].map((a) => `'${a}'`).join(' ')], { encoding: 'utf8' })
    : spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
};

export function psql(db, args, input) {
  const r = spawnSync('psql', ['-h', '127.0.0.1', '-p', String(PGPORT), '-U', 'postgres', '-d', db, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args],
    { encoding: 'utf8', input, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout;
}

export function start() {
  if (!existsSync(path.join(PGDATA, 'PG_VERSION'))) {
    mkdirSync(PGDATA, { recursive: true });
    if (process.getuid?.() === 0) execFileSync('chown', ['-R', 'postgres', PGDATA]);
    asPg(path.join(PG_BIN, 'initdb'), ['-D', PGDATA, '-A', 'trust', '-U', 'postgres']);
  }
  const status = spawnSync('su', ['postgres', '-c', `${PG_BIN}/pg_ctl -D ${PGDATA} status`], { encoding: 'utf8' });
  if (status.status !== 0) {
    asPg(path.join(PG_BIN, 'pg_ctl'), ['-D', PGDATA, '-w', '-l', path.join(PGDATA, 'server.log'),
      '-o', `-p ${PGPORT} -c listen_addresses=127.0.0.1 -k /tmp -c log_min_messages=warning`, 'start']);
  }
}

export function stop() {
  asPg(path.join(PG_BIN, 'pg_ctl'), ['-D', PGDATA, '-m', 'fast', 'stop']);
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

const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
export const fullSha = (ref) => git('rev-parse', '--verify', `${ref}^{commit}`).trim();
export function migrationsAt(sha) {
  return git('ls-tree', '--name-only', sha, 'supabase/migrations/').trim().split('\n').filter((f) => f.endsWith('.sql')).sort()
    .map((p) => ({ name: path.basename(p), sql: git('show', `${sha}:${p}`) }));
}

function applyFile(db, name, sql, kind) {
  const cleaned = sql.replace(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+"?pg_(cron|net)"?[^;]*;/gi, '');
  const file = path.join('/tmp', `lab-${db}-${name}`);
  writeFileSync(file, `SET search_path = public, extensions;\n${cleaned}\n;INSERT INTO lab_meta.applied(name, kind) VALUES ('${name}', '${kind}');\n`);
  try { psql(db, ['-1', '-f', file]); } catch (e) { throw new Error(`${name}: ${e.message.split('\n').slice(0, 4).join(' | ')}`); }
}

export function build(db, { main, pending }) {
  start();
  psql('postgres', ['-c', `DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`]);
  psql('postgres', ['-c', `CREATE DATABASE "${db}"`]);
  psql(db, ['-c', `ALTER DATABASE "${db}" SET search_path = public, extensions`]);
  // Roles are cluster-wide: create them once.
  const roles = psql('postgres', ['-At', '-c', "select count(*) from pg_roles where rolname='authenticator'"]).trim();
  let stubs = readFileSync(path.join(LAB, 'supabase-stubs.sql'), 'utf8');
  if (roles === '1') stubs = stubs.replace(/^CREATE ROLE[^\n]*\n/gm, '').replace(/^GRANT anon, authenticated, service_role TO authenticator;\n/m, '');
  psql(db, ['-1'], stubs + '\nCREATE SCHEMA lab_meta; CREATE TABLE lab_meta.applied (name text PRIMARY KEY, kind text, at timestamptz DEFAULT now());\n');
  const mainSha = fullSha(main);
  const files = migrationsAt(mainSha);
  for (const f of files) applyFile(db, f.name, REPAIRS[f.name] ? repair(f.sql, REPAIRS[f.name]) : f.sql, 'main');
  psql(db, ['-c', `CREATE TABLE lab_meta.build AS SELECT '${mainSha}'::text AS main_sha, ${files.length} AS main_files, now() AS built_at`]);
  if (pending) applyPending(db, { main: mainSha, stack: pending });
  return { mainSha, files: files.length };
}

export function pendingFiles({ main, stack }) {
  const onMain = new Set(migrationsAt(fullSha(main)).map((m) => m.name));
  return migrationsAt(fullSha(stack)).filter((m) => !onMain.has(m.name));
}

export function applyPending(db, { main, stack, only }) {
  const files = pendingFiles({ main, stack }).filter((f) => !only || only.includes(f.name));
  for (const f of files) applyFile(db, f.name, f.sql, 'pending');
  return files.map((f) => f.name);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, db, ...rest] = process.argv.slice(2);
  const opt = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === 'start') { start(); console.log(`postgres on 127.0.0.1:${PGPORT}`); }
  else if (cmd === 'stop') stop();
  else if (cmd === 'build') console.log(JSON.stringify(build(db, { main: opt('--main'), pending: opt('--pending') })));
  else if (cmd === 'apply-pending') console.log(JSON.stringify(applyPending(db, { main: opt('--main'), stack: opt('--stack'), only: opt('--only')?.split(',') })));
  else throw new Error('usage: start | stop | build <db> --main <sha> [--pending <sha>] | apply-pending <db> --main <sha> --stack <sha> [--only a,b]');
}
