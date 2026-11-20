// Rehearses the real-data staging path end to end, entirely inside the lab:
//   prodsim    = main schema + representative data (stands in for production; never written by the export)
//   stagingsim = main schema + the 5 pending migrations, NO data (stands in for the new staging project)
// 1. export-own-data.mjs as Ayla from prodsim  -> bundle
// 2. prodsim snapshot before/after export must be identical (export is read-only)
// 3. import-own-data.mjs into stagingsim
// 4. the NEW app signs in to stagingsim with the staging account and edits like a tester on the iPhone
// 5. compare-staging.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { psql, applyPending, fullSha } from './db.mjs';
import { USERS, id } from './seed.mjs';
import { up } from './stack.mjs';
import { snapshot, diff } from './snapshot.mjs';
import { anonKey, signJwt, STATE } from './gateway.mjs';
import { openBrowser, newPage, signIn, text, goto, wait } from './browser.mjs';

const REPO_STAGING = process.env.STAGING_TOOLS ?? '/home/claude/afiyeat/qa/compat/staging';
const MAIN = fullSha('9baf34e0b287b7dbb6b11909a1b509693cbcede0');
const NEW = fullSha('4973aa7216e7e147966c1c86b79161144d2d8395');
const out = { checks: [] };
const rec = (name, ok, detail = '') => { out.checks.push({ name, result: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const recreate = (db, template) => { psql('postgres', ['-c', `DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`]); psql('postgres', ['-c', `CREATE DATABASE "${db}" TEMPLATE "${template}"`]); };
// Async on purpose: the lab gateway runs in THIS process, so a blocking spawn would deadlock it.
const run = (script, args, env) => new Promise((resolve) => {
  const c = spawn('node', [path.join(REPO_STAGING, script), ...args], { env: { ...process.env, ...env } });
  let o = ''; c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { o += d; });
  const t = setTimeout(() => c.kill('SIGKILL'), 300000);
  c.on('exit', (code) => { clearTimeout(t); resolve({ ok: code === 0, out: o }); });
});

// Forget staging accounts a previous rehearsal created in the lab's sign-in list.
const usersFile = path.join(STATE, 'users.json');
writeFileSync(usersFile, JSON.stringify(JSON.parse(readFileSync(usersFile, 'utf8')).filter((u) => !String(u.key).startsWith('admin-')), null, 1));
recreate('prodsim', 'compat_pre');           // seeded main schema, before migrations (what production is today)
recreate('stagingsim', 'baseline');          // main schema, no data
applyPending('stagingsim', { main: MAIN, stack: NEW });
// The proposed staging change S3: create the private custom-list-images bucket (main's migrations never do).
psql('stagingsim', ['-c', "INSERT INTO storage.buckets (id, name, public) VALUES ('custom-list-images', 'custom-list-images', false)"]);
const work = mkdtempSync(path.join(os.tmpdir(), 'afiyeat-staging-rehearsal-'));
const bundle = path.join(work, 'export');
const service = signJwt({ iss: 'afiyeat-compat-lab', role: 'service_role', iat: 1700000000, exp: 2100000000 });

// 1-2. Export (read-only) from prodsim
let lab = await up('prodsim');
const P0 = await snapshot('prodsim');
const ex = await run('export-own-data.mjs', ['--out', bundle], { EXPORT_SOURCE_URL: 'http://127.0.0.1:8101', EXPORT_SOURCE_KEY: anonKey(), EXPORT_EMAIL: USERS.ayla.email, EXPORT_PASSWORD: USERS.ayla.password });
console.log(ex.out.trim().split('\n').map((l) => `   | ${l}`).join('\n'));
rec('export runs', ex.ok);
const P1 = await snapshot('prodsim');
const dExport = diff(P0, P1);
rec('export changed nothing in the source database', Object.keys(dExport).length === 0, Object.keys(dExport).join(', ') || 'identical');
await lab.close();
const manifest = JSON.parse(readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
const data = JSON.parse(readFileSync(path.join(bundle, 'data.json'), 'utf8'));
rec('export requests were read-only', manifest.requests.every((r) => /^GET |^POST \/auth\/v1\/(token|logout)|^POST \/storage\/v1\/object\/sign\//.test(r)), manifest.requests.join(' ; '));
const ownLists = Object.values(P0['public.custom_lists']).filter((l) => l.user_id === USERS.ayla.id).length;
const ownItems = Object.values(P0['public.custom_list_items']).filter((l) => l.user_id === USERS.ayla.id).length;
rec('export holds every one of Ayla\'s lists and items', data.custom_lists.length === ownLists && data.custom_list_items.length === ownItems, `${data.custom_lists.length}/${ownLists} lists, ${data.custom_list_items.length}/${ownItems} items`);
rec('export holds no one else\'s lists', data.custom_lists.every((l) => l.user_id === USERS.ayla.id));
const others = Object.values(USERS).filter((u) => u.key !== 'ayla');
const blob = readFileSync(path.join(bundle, 'data.json'), 'utf8') + readFileSync(path.join(bundle, 'manifest.json'), 'utf8');
const leaks = others.flatMap((u) => [u.id, u.email, `"${u.username}"`, u.name].filter((v) => blob.includes(v)));
rec('no other person\'s id, email or username appears in the export', leaks.length === 0, leaks.join(', ') || `${manifest.members.length} pseudonymous members`);
rec('other member\'s shared-list place and comment are redacted', !blob.includes('Balıkçı Sabahattin') && data.shared_list_items.some((i) => /Place added by Member/.test(i.name)), data.shared_list_items.map((i) => i.name).join(' / '));
rec('no passwords, tokens or emails in the export', !/password|access_token|refresh_token|@lab\.afiyeat\.test/.test(blob));
rec('photos exported with checksums', manifest.photos.filter((p) => p.sha256).length > 0, `${manifest.photos.filter((p) => p.sha256).length} downloaded, ${manifest.photos.filter((p) => p.missing).length} missing in source: ${manifest.notes.join(' ; ')}`);

// 3. Import into stagingsim
lab = await up('stagingsim');
const im = await run('import-own-data.mjs', ['--bundle', bundle], { STAGING_LAB_URL: 'http://127.0.0.1:8102', STAGING_SERVICE_ROLE_KEY_LAB: service, STAGING_EMAIL: 'ayla-staging@lab.afiyeat.test', STAGING_PASSWORD: 'lab-ayla-staging-password' });
console.log(im.out.trim().split('\n').map((l) => `   | ${l}`).join('\n'));
rec('import runs', im.ok);
const report = JSON.parse(readFileSync(path.join(bundle, 'import-report.json'), 'utf8'));
const S0 = await snapshot('stagingsim');
const ids = (t) => Object.values(S0[`public.${t}`]).filter((r) => data[t].some((e) => e.id === r.id)).length;
rec('every exported row is in staging with its original id', Object.keys(data).filter((t) => t !== 'profiles').every((t) => ids(t) === data[t].length), Object.keys(data).filter((t) => t !== 'profiles').map((t) => `${t} ${ids(t)}/${data[t].length}`).join(', '));
const unrestorable = report.deviations.filter((d) => d.problem || Object.keys(d.still_different ?? {}).some((c) => !(d.table === 'profiles' && c === 'updated_at')));
rec('values identical to the export (after restoring trigger changes; only the profile\'s updated_at is re-stamped)', unrestorable.length === 0, JSON.stringify(report.deviations.map((d) => ({ t: d.table, changed: d.changed_by_trigger, still: Object.keys(d.still_different ?? {}) }))));
rec('existing lists arrive with default visibility "profile" (not converted)', Object.values(S0['public.custom_lists']).every((l) => l.visibility === 'profile'));
rec('photos uploaded to the same paths and verified', report.summary.photos_verified === manifest.photos.filter((p) => p.sha256).length, `${report.summary.photos_verified}/${report.summary.photos_total}`);

// 4. New app on staging, signed in with the staging account: the iPhone tester's actions
const browser = await openBrowser();
const page = await newPage(browser, 'http://127.0.0.1:8102');
await page.setViewport({ width: 390, height: 844 });
await signIn(page, 'ayla-staging@lab.afiyeat.test', 'lab-ayla-staging-password');
await goto(page, '/my-lists'); await wait(1200);
const home = await text(page);
const shown = data.custom_lists.filter((l) => home.includes(l.name)).length;
rec('Lists V2 on staging shows the imported lists', shown >= data.custom_lists.filter((l) => !/^$/.test(l.name)).length - 3, `${shown}/${data.custom_lists.length} names on the Lists screen`);
await goto(page, `/my-lists/${id('list:ayla:coffee')}`); await wait(1200);
const coffee = await text(page);
rec('a list with photos opens', /Kronotrop|Petra/.test(coffee));
await page.close(); await browser.close();

// 5. Compare
const cmp = await run('compare-staging.mjs', ['--bundle', bundle, '--label', 'rehearsal'], { STAGING_LAB_URL: 'http://127.0.0.1:8102', STAGING_SERVICE_ROLE_KEY_LAB: service });
rec('compare runs', cmp.ok, cmp.ok ? '' : cmp.out.slice(-400));
const md = cmp.ok ? readFileSync(path.join(bundle, 'compare-rehearsal.md'), 'utf8') : '';
rec('compare: no exported row deleted', /Exported rows deleted: \*\*0\*\*/.test(md));
rec('compare: all exported photos still present', /still present: \*\*(\d+)\/\1\*\*/.test(md));
await lab.close();
writeFileSync('/home/claude/compat/results/staging-rehearsal.json', JSON.stringify({ ...out, import_summary: report.summary, compare: md }, null, 1));
writeFileSync('/home/claude/compat/results/staging-rehearsal-compare.md', md);
rmSync(work, { recursive: true, force: true });
console.log(`\n${out.checks.filter((c) => c.result === 'PASS').length}/${out.checks.length} passed`);
process.exit(0);
