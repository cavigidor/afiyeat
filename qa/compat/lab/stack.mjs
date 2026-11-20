// Starts the lab: PostgREST on one local database, and two gateways serving
// the OLD app (main) and the NEW app (Lists V2 trial) against the SAME data.
//
//   node stack.mjs build-apps               # builds both apps pointed at the lab (never production)
//   node stack.mjs up <dbname>              # PostgREST + gateways (foreground)
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { startGateway, anonKey, jwtSecret, STATE } from './gateway.mjs';

const LAB = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(LAB, '..');
export const APPS = {
  old: { dir: path.join(ROOT, 'old'), port: 8101 },
  new: { dir: path.join(ROOT, 'new'), port: 8102 },
};
export const PGRST_PORT = 3010;
const PROD_REF = 'dmlkjpjubneqhbqoxlct';

export function buildApps() {
  for (const [name, app] of Object.entries(APPS)) {
    const env = { ...process.env, VITE_SUPABASE_URL: `http://127.0.0.1:${app.port}`, VITE_SUPABASE_PUBLISHABLE_KEY: anonKey(), VITE_SUPABASE_PROJECT_ID: 'compat-lab' };
    const r = spawnSync('npx', ['vite', 'build', '--outDir', 'dist-lab', '--emptyOutDir'], { cwd: app.dir, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`${name} build failed: ${r.stderr.slice(-2000)}`);
    const out = path.join(app.dir, 'dist-lab');
    const js = readdirSync(path.join(out, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(out, 'assets', f), 'utf8')).join('\n');
    if (js.includes(PROD_REF)) throw new Error(`${name} lab build contains the production project id - refusing`);
    if (!js.includes(`127.0.0.1:${app.port}`)) throw new Error(`${name} lab build doesn't point at the lab gateway`);
    const sha = spawnSync('git', ['-C', app.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(out, 'lab-build.json'), JSON.stringify({ app: name, sha, url: env.VITE_SUPABASE_URL }));
    console.log(`built ${name} @ ${sha.slice(0, 7)} -> http://127.0.0.1:${app.port} (no production id in bundle)`);
  }
}

let pgrst = null;
// Never leave a PostgREST behind, even when the calling script crashes.
process.on('exit', () => { try { pgrst?.kill('SIGKILL'); } catch { /* gone */ } });
export async function stopPostgrest() {
  if (!pgrst) return;
  const p = pgrst; pgrst = null;
  await new Promise((r) => { p.once('exit', r); p.kill('SIGTERM'); setTimeout(r, 3000); });
}
export async function startPostgrest(db) {
  await stopPostgrest();
  // A PostgREST left over from a crashed run would answer the readiness poll for the WRONG database.
  try { await fetch(`http://127.0.0.1:${PGRST_PORT}/`); throw new Error(`port ${PGRST_PORT} is already in use (stale PostgREST?). Stop it first: pkill -f compat/postgrest`); }
  catch (e) { if (/already in use/.test(e.message)) throw e; }
  const conf = path.join(STATE, 'postgrest.conf');
  writeFileSync(conf, [
    `db-uri = "postgres://authenticator:lab-only-authenticator@127.0.0.1:${process.env.LAB_PGPORT ?? 54329}/${db}"`,
    'db-schemas = "public"', 'db-anon-role = "anon"', `jwt-secret = "${jwtSecret()}"`,
    `server-host = "127.0.0.1"`, `server-port = ${PGRST_PORT}`, 'db-max-rows = 1000', 'log-level = "warn"', 'jwt-aud = "authenticated"',
  ].join('\n'));
  pgrst = spawn(path.join(ROOT, 'postgrest'), [conf], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  pgrst.stdout.on('data', (d) => { log += d; });
  pgrst.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (pgrst?.exitCode != null) throw new Error(`PostgREST exited: ${log}`);
    try { const r = await fetch(`http://127.0.0.1:${PGRST_PORT}/`); if (r.status < 500) return { db, log: () => log }; } catch { /* starting */ }
  }
  throw new Error(`PostgREST didn't start: ${log}`);
}

export async function up(db) {
  await startPostgrest(db);
  const gws = [];
  for (const [name, app] of Object.entries(APPS)) {
    gws.push(await startGateway({ port: app.port, appDir: path.join(app.dir, 'dist-lab'), dbName: db, pgrstPort: PGRST_PORT, label: name }));
  }
  let closed = false;
  return { close: async () => { if (closed) return; closed = true; for (const g of gws) await g.close(); await stopPostgrest(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, db] = process.argv.slice(2);
  if (cmd === 'build-apps') buildApps();
  else if (cmd === 'up') { await up(db); console.log(`lab up on db ${db}: old http://127.0.0.1:${APPS.old.port}  new http://127.0.0.1:${APPS.new.port}`); }
  else throw new Error('usage: build-apps | up <db>');
}
