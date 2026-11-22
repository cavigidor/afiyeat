// Lab check: apply db/proposals/lists_v2_owner_fields.sql the way Lovable's migration tool does, on a real,
// throwaway Postgres server, and watch it from a second session. Never connects anywhere else.
//
// How Lovable applies a migration on this project (main, 2026-11-21): drizzle.config.ts points drizzle-kit at
// LOVABLE_DB_MIGRATION_URL, migrations live in drizzle/migrations/ with a journal, and the app pins
// drizzle-kit 0.31.11, drizzle-orm 0.45.3 and the `postgres` driver 3.4.9 (no `pg`). drizzle-kit migrate then
// uses drizzle-orm's postgres-js migrator: one `begin` for the whole run, each migration file sent as one
// query (no statement breakpoints in the file), the journal row inserted, then `commit`; any error rolls back.
// This script runs exactly that: those package versions (scripts/lab/drizzle-runner), `drizzle-kit migrate`,
// a journal like Lovable's, and the file as migration 0000.
//
// It shows:
//   1. While the migration runs (paused right after the table grants, and again after the last statement),
//      a second session sees no new table, as anon or signed in, and no journal row.
//   2. A failure injected after any statement (including right after the table grants) leaves no table,
//      function, policy, trigger or journal row behind.
//   3. A successful run passes all nine postchecks, digest 4816778c included, and anon is refused.
//   4. Control: the same failure after an embedded COMMIT does leave objects behind, so the check can tell.
//
// Run from the repository root:  node scripts/lab/owner-fields-drizzle.mjs   (PGBIN=/path/to/postgres/bin)
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const RUNNER = resolve(ROOT, 'scripts/lab/drizzle-runner');
const SQL = readFileSync(resolve(ROOT, 'db/proposals/lists_v2_owner_fields.sql'), 'utf8');
const POSTCHECK = resolve(ROOT, 'db/proposals/lists_v2_owner_fields_postcheck.sql');
const STUBS = readFileSync(resolve(ROOT, 'tests/fixtures/supabase-stubs.sql'), 'utf8');
const PGBIN = process.env.PGBIN ?? '/usr/lib/postgresql/16/bin';
const WORK = mkdtempSync(join(tmpdir(), 'owner-fields-'));
const PORT = String(54000 + Math.floor(Math.random() * 1000));
const URL_ = `postgres://postgres@127.0.0.1:${PORT}/lab`; // loopback only, trust auth, removed at exit
let failures = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };

if (!existsSync(join(RUNNER, 'node_modules/.bin/drizzle-kit'))) {
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: RUNNER, stdio: 'inherit' });
}
const kitVersion = JSON.parse(readFileSync(join(RUNNER, 'node_modules/drizzle-kit/package.json'), 'utf8')).version;
const ormVersion = JSON.parse(readFileSync(join(RUNNER, 'node_modules/drizzle-orm/package.json'), 'utf8')).version;
const pgjsVersion = JSON.parse(readFileSync(join(RUNNER, 'node_modules/postgres/package.json'), 'utf8')).version;

execFileSync(join(PGBIN, 'initdb'), ['-D', join(WORK, 'data'), '-U', 'postgres', '-A', 'trust'], { stdio: 'ignore' });
execFileSync(join(PGBIN, 'pg_ctl'), ['-D', join(WORK, 'data'), '-o', `-k ${WORK} -p ${PORT} -c listen_addresses=127.0.0.1 -c log_statement=all -c log_line_prefix='%p|'`, '-l', join(WORK, 'log'), '-w', 'start'], { stdio: 'ignore' });
const stop = () => { spawnSync(join(PGBIN, 'pg_ctl'), ['-D', join(WORK, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }); rmSync(WORK, { recursive: true, force: true }); };
process.on('exit', stop);

const psql = (db, sql, { file } = {}) => {
  const args = ['-h', WORK, '-p', PORT, '-U', 'postgres', '-d', db, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...(file ? ['-f', file] : ['-c', sql])];
  const r = spawnSync(join(PGBIN, 'psql'), args, { encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c client_min_messages=error' } });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
};

// Supabase stand-ins (as the in-process tests use) plus the two existing tables the file refers to. As on
// Supabase, new public tables are granted to anon and authenticated by default; the file's REVOKE removes that.
psql('postgres', STUBS.split('\n').filter((l) => l.startsWith('CREATE ROLE')).join('\n'));
function freshDb() {
  psql('postgres', 'DROP DATABASE IF EXISTS lab');
  psql('postgres', 'CREATE DATABASE lab');
  writeFileSync(join(WORK, 'stubs.sql'), STUBS.split('\n').filter((l) => !l.startsWith('CREATE ROLE')).join('\n'));
  const a = psql('lab', '', { file: join(WORK, 'stubs.sql') });
  const b = psql('lab', `CREATE TABLE public.custom_lists (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
    CREATE TABLE public.custom_list_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), list_id uuid NOT NULL REFERENCES public.custom_lists(id) ON DELETE CASCADE);`);
  if (!a.ok || !b.ok) throw new Error(`setup failed: ${a.err} ${b.err}`);
}

// A drizzle project like Lovable's: config, journal (breakpoints: true), and the file as migration 0000.
function drizzleProject(sqlText) {
  const dir = join(WORK, `proj-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, 'migrations/meta'), { recursive: true });
  writeFileSync(join(dir, 'migrations/0000_owner_fields.sql'), sqlText);
  writeFileSync(join(dir, 'migrations/meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'postgresql',
    entries: [{ idx: 0, version: '7', when: Date.now(), tag: '0000_owner_fields', breakpoints: true }] }, null, 2));
  writeFileSync(join(dir, 'drizzle.config.json'), JSON.stringify({ dialect: 'postgresql', out: join(dir, 'migrations'), dbCredentials: { url: URL_ } }));
  return dir;
}
function migrate(sqlText) { // resolves to { code, out }
  const dir = drizzleProject(sqlText);
  return new Promise((done) => {
    const p = spawn(join(RUNNER, 'node_modules/.bin/drizzle-kit'), ['migrate', '--config', join(dir, 'drizzle.config.json')], { cwd: RUNNER });
    let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => done({ code, out }));
  });
}

// Top-level statements: a line ending in ';' outside a $$ body ends one.
function statements(sql) {
  const out = []; let cur = []; let inBody = false;
  for (const line of sql.split('\n')) {
    cur.push(line);
    if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inBody = !inBody;
    if (!inBody && !line.startsWith('--') && line.trimEnd().endsWith(';')) { out.push(cur.join('\n')); cur = []; }
  }
  return { parts: out, tail: cur.join('\n') };
}
const { parts, tail } = statements(SQL);
const withAfter = (i, extra) => [...parts.slice(0, i + 1), extra, ...parts.slice(i + 1), tail].join('\n');
const GRANTS = parts.findIndex((p) => p.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_list_owner_settings'));

const seenBySecondSession = () => ({
  tables: psql('lab', `SELECT coalesce(to_regclass('public.custom_list_owner_settings')::text, '-') || ',' || coalesce(to_regclass('public.custom_list_item_owner_values')::text, '-')`).out,
  anon: psql('lab', 'SET ROLE anon; SELECT count(*) FROM public.custom_list_owner_settings').err.split('\n')[0] || 'READ ALLOWED',
  authenticated: psql('lab', 'SET ROLE authenticated; SELECT count(*) FROM public.custom_list_owner_settings').err.split('\n')[0] || 'READ ALLOWED',
  journal: psql('lab', `SELECT CASE WHEN to_regclass('drizzle.__drizzle_migrations') IS NULL THEN 0 ELSE (SELECT count(*) FROM drizzle.__drizzle_migrations) END`).out,
});
const leftovers = () => Number(psql('lab', `SELECT
    (SELECT count(*) FROM pg_class WHERE relname IN ('custom_list_owner_settings', 'custom_list_item_owner_values'))
  + (SELECT count(*) FROM pg_proc WHERE proname LIKE 'lv2\\_%' OR proname IN ('count_custom_list_field_values', 'delete_custom_list_field', 'export_my_list_owner_data'))
  + (SELECT count(*) FROM pg_policies WHERE tablename IN ('custom_list_owner_settings', 'custom_list_item_owner_values'))
  + (SELECT count(*) FROM pg_trigger WHERE tgname IN ('lv2_check_owner_values', 'lv2_guard_field_removal'))
  + (SELECT CASE WHEN to_regclass('drizzle.__drizzle_migrations') IS NULL THEN 0 ELSE (SELECT count(*) FROM drizzle.__drizzle_migrations) END)`).out);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The server log (log_statement=all) shows what the runner actually sent, and the errors.
let logAt = 0;
const newLog = () => { const t = readFileSync(join(WORK, 'log'), 'utf8'); const s = t.slice(logAt); logAt = t.length; return s; };
// What drizzle-kit's own connection sent, in order: one line per statement, first 70 characters.
function runnerStatements(log) {
  const lines = log.split('\n'); const pids = new Map();
  for (const l of lines) { const m = l.match(/^(\d+)\|LOG:  (?:statement|execute [^:]*): ([\s\S]*)$/); if (m) pids.set(m[1], [...(pids.get(m[1]) ?? []), m[2]]); }
  const runner = [...pids.values()].find((st) => st.some((x) => /^begin/i.test(x))) ?? [];
  return runner.map((x) => x.replace(/\s+/g, ' ').trim().slice(0, 70));
}

console.log(`Postgres ${execFileSync(join(PGBIN, 'postgres'), ['--version'], { encoding: 'utf8' }).trim().split(' ').pop()}, drizzle-kit ${kitVersion}, drizzle-orm ${ormVersion}, postgres ${pgjsVersion}`);
console.log(`File: ${parts.length} statements; table grants are statement ${GRANTS + 1}; transaction-control statements: ${parts.filter((p) => /^\s*(BEGIN|COMMIT|ROLLBACK|START TRANSACTION|END)\s*;/im.test(p.split('\n').filter((l) => !l.startsWith('--')).join('\n'))).length}`);

for (const [label, at] of [['right after the table grants', GRANTS], ['after the last statement', parts.length - 1]]) {
  console.log(`\n== Success run through drizzle-kit migrate, paused ${label}`);
  freshDb();
  newLog();
  const run = migrate(withAfter(at, 'SELECT pg_sleep(4);'));
  await sleep(2500);
  const seen = seenBySecondSession();
  console.log(`  second session: tables ${seen.tables} | anon: ${seen.anon} | signed in: ${seen.authenticated} | journal rows ${seen.journal}`);
  check(seen.tables === '-,-', 'no new table visible mid-migration');
  check(/does not exist/.test(seen.anon) && /does not exist/.test(seen.authenticated), 'anon and signed-in sessions cannot use either table mid-migration');
  check(seen.journal === '0', 'no journal row mid-migration');
  const r = await run;
  check(r.code === 0, 'drizzle-kit migrate succeeded');
  const post = psql('lab', '', { file: POSTCHECK });
  const rows = post.out.split('\n').filter(Boolean);
  check(rows.length === 9 && rows.every((l) => l.endsWith('|t')), `all 9 postchecks true, including "applied exactly" (digest 4816778c)${rows.length === 9 ? '' : `: ${post.out} ${post.err}`}`);
  check(psql('lab', 'SELECT count(*) FROM drizzle.__drizzle_migrations').out === '1', 'journal row recorded with the migration');
  check(!psql('lab', 'SET ROLE anon; SELECT 1 FROM public.custom_list_owner_settings').ok, 'anon refused after the migration');
  const sent = runnerStatements(newLog());
  const fileSent = sent.filter((x) => x.startsWith('-- ======'));
  console.log('  what the runner sent (multi-line statements show their first line):\n' + sent.filter(Boolean).map((x) => `    ${x}`).join('\n'));
  const at_ = (re) => sent.findIndex((x) => re.test(x));
  const iBegin = at_(/^begin\b/i), iFile = at_(/^-- =====/), iInsert = at_(/^insert into "drizzle"/), iCommit = at_(/^commit\b/i);
  check(fileSent.length === 1 && iBegin >= 0 && iBegin < iFile && iFile < iInsert && iInsert < iCommit && iCommit === sent.length - 1,
    'the runner sent: begin, the whole file as one query, the journal insert, commit');
}

console.log('\n== Failure injected after each statement, through drizzle-kit migrate');
let clean = 0;
for (let i = 0; i < parts.length; i++) {
  freshDb();
  newLog();
  const r = await migrate(withAfter(i, 'SELECT 1/0; -- injected failure'));
  const log = newLog();
  const n = leftovers();
  if (r.code !== 0 && /ERROR:  division by zero/.test(log) && /\|LOG:  statement: rollback|\|LOG:  execute [^:]*: rollback/i.test(log) && n === 0) clean++;
  else console.log(`  FAIL after statement ${i + 1}: exit ${r.code}, ${n} objects left\n${r.out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').slice(-600)}`);
}
check(clean === parts.length, `${clean}/${parts.length} injected failures: the runner rolled back and nothing was left (no table, function, policy, trigger or journal row)`);

console.log('\n== Failure right after the table grants, watched from a second session');
freshDb();
newLog();
const failing = migrate(withAfter(GRANTS, 'SELECT pg_sleep(4);\nSELECT 1/0; -- injected failure'));
await sleep(2500);
const seenF = seenBySecondSession();
console.log(`  second session: tables ${seenF.tables} | anon: ${seenF.anon} | signed in: ${seenF.authenticated}`);
check(seenF.tables === '-,-', 'no new table visible while it ran');
const rf = await failing;
check(rf.code !== 0 && /ERROR:  division by zero/.test(newLog()), 'the run stopped on the error (exit code and server log)');
check(leftovers() === 0, 'nothing left behind afterwards');

console.log('\n== Control: an embedded COMMIT after the table grants, then a failure');
freshDb();
const rc = await migrate(withAfter(GRANTS, 'COMMIT;\nSELECT 1/0; -- injected failure'));
const nc = leftovers();
check(rc.code !== 0 && nc > 0, `the check detects partial application (${nc} objects left), so the passes above are meaningful`);

console.log(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exitCode = failures === 0 ? 0 : 1;
