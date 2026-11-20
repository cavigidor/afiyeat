#!/usr/bin/env node
// Loads an own-data export (export-own-data.mjs) into the APPROVED STAGING project only.
//
//   STAGING_CONFIRM_PROJECT_REF=<staging ref> node qa/compat/staging/import-own-data.mjs --bundle ~/AfiyeatStaging/export-2026-11-20
//
// Needs qa/compat/staging/approved-target.json (written by the PM, operation "load-own-data") and the
// staging project's service_role key, typed at the prompt (not saved, refused if it belongs to another project).
// Production is refused by ref and by URL before any connection.
//
// What it does, in the staging project:
//   1. Refuses if any exported id already exists there (it never overwrites).
//   2. Creates your staging sign-in with the SAME user id as production (so photo paths, which start
//      with your id, stay exactly as stored). You choose its password. Email is not sent (auto-confirmed).
//   3. Creates one placeholder account per pseudonymous member ("Member 1"), with that member's
//      privacy setting, so shared lists, follows and blocks keep working.
//   4. Inserts every exported row with its original id and values, then reads each one back and
//      compares it field by field with the export. Anything a database trigger changed is restored
//      where possible and listed in import-report.json.
//   5. Uploads your photos to the same bucket and path, and checks each one's sha256.
//   6. Saves a staging snapshot (staging-baseline.json) to compare against after testing on the iPhone.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { readApproval, checkKeyFor, PRODUCTION_REF } from './lib/target.mjs';
import { TABLES, sha256, canon, ask } from './lib/common.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const bundle = arg('--bundle');
if (!bundle || !existsSync(path.join(bundle, 'manifest.json'))) { console.error('usage: import-own-data.mjs --bundle <export folder>'); process.exit(2); }
const target = readApproval('load-own-data');
const URL0 = target.project_url;
if (URL0.includes(PRODUCTION_REF)) throw new Error('REFUSED: production');
const manifest = JSON.parse(readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
const data = JSON.parse(readFileSync(path.join(bundle, 'data.json'), 'utf8'));
if (manifest.kind !== 'afiyeat-own-data-export') throw new Error('not an own-data export');
for (const [t, rows] of Object.entries(data)) for (const r of rows) {
  if (manifest.row_hashes[t]?.[r.id ?? r.user_id] !== sha256(canon(r))) throw new Error(`export was edited: ${t} ${r.id}. Re-export rather than repair it.`);
}
const me = manifest.account;
console.log(`target: ${URL0}${target.lab ? ' (local lab rehearsal)' : ` (approved by ${target.approved_by} until ${target.expires_on})`}`);

const SERVICE = checkKeyFor(target, process.env.STAGING_SERVICE_ROLE_KEY_LAB && target.lab ? process.env.STAGING_SERVICE_ROLE_KEY_LAB : await ask('Staging service_role key (not shown, not saved): ', { hidden: true }), 'service_role');
const stagingEmail = (target.lab ? process.env.STAGING_EMAIL : await ask('Email for your STAGING sign-in: ')) || '';
const stagingPassword = target.lab ? process.env.STAGING_PASSWORD : await ask('Password for your STAGING sign-in (not shown, not saved): ', { hidden: true });
if (!/@/.test(stagingEmail) || (stagingPassword ?? '').length < 8) throw new Error('need an email and a password of at least 8 characters');

async function api(method, p, { body, raw, headers = {}, ok = [200, 201, 204] } = {}) {
  const r = await fetch(URL0 + p, {
    method, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
  });
  const text = await r.text();
  if (!ok.includes(r.status)) throw new Error(`${method} ${p.split('?')[0]} -> HTTP ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const report = { target: URL0, started_at: new Date().toISOString(), account: me, created_accounts: [], removed_auto_rows: [], deviations: [], photos: [], counts: {} };

// 0. Preflight: the buckets the photos live in must already exist in staging, private like production.
//    (main's migrations create restaurant-images but NOT custom-list-images; production's was made outside
//    migrations, so staging needs it created as an approved staging change - see qa/compat/staging/README.md.)
for (const bucket of new Set(manifest.photos.filter((p) => p.sha256).map((p) => p.bucket))) {
  const b = await api('GET', `/storage/v1/bucket/${bucket}`, { ok: [200, 400, 404] });
  if (!b?.id) throw new Error(`STOPPED before any change: staging has no "${bucket}" bucket. Create it first (private), as in the staging proposal.`);
  if (b.public) console.log(`warning: staging bucket ${bucket} is PUBLIC; production's should be private - check before testing privacy`);
}

// 1. Nothing to overwrite
for (const [t, rows] of Object.entries(data)) {
  if (t === 'profiles') continue;
  for (let i = 0; i < rows.length; i += 150) {
    const ids = rows.slice(i, i + 150).map((r) => r.id);
    const hit = await api('GET', `/rest/v1/${t}?select=id&id=in.(${ids.join(',')})`);
    if (hit.length) throw new Error(`STOPPED: ${t} already has ${hit.length} of these ids in staging. Nothing was changed. Use a fresh staging project.`);
  }
}

// 2-3. Accounts (same id for you; placeholders for members)
async function createUser(id, email, password, meta) {
  const u = await api('POST', '/auth/v1/admin/users', { body: { id, email, password, email_confirm: true, user_metadata: meta } });
  const got = u.id ?? u.user?.id;
  if (got !== id) throw new Error(`staging created ${email} with id ${got}, not ${id}; stop and delete that account in staging`);
  return got;
}
const ownProfile = data.profiles[0] ?? {};
await createUser(me, stagingEmail, stagingPassword, { username: ownProfile.username, display_name: ownProfile.display_name });
report.created_accounts.push({ id: me, email: stagingEmail, role: 'you' });
const memberPasswords = [];
for (const m of manifest.members) {
  const n = m.label.replace(/\D/g, '');
  const email = `afiyeat-staging-member-${n}-${m.id.slice(0, 6)}@example.com`;
  const password = crypto.randomBytes(12).toString('base64url');
  await createUser(m.id, email, password, { username: `member_${n}_${m.id.slice(0, 4)}`, display_name: m.label });
  report.created_accounts.push({ id: m.id, email, role: m.label });
  memberPasswords.push({ label: m.label, email, password });
  if (m.is_private != null) await api('PATCH', `/rest/v1/profiles?user_id=eq.${m.id}`, { body: { is_private: m.is_private, bio: `Placeholder for ${m.label}` } });
}
if (memberPasswords.length) writeFileSync(path.join(bundle, 'staging-member-accounts.local.json'), JSON.stringify(memberPasswords, null, 1), { mode: 0o600 });

// The sign-up trigger creates a profile and default folders for every new account. Your real profile and
// folders come from the export, so the auto-created ones for YOUR account are replaced.
const autoFolders = await api('GET', `/rest/v1/folders?select=id,name&user_id=eq.${me}`);
if (autoFolders.length) {
  await api('DELETE', `/rest/v1/folders?user_id=eq.${me}&id=in.(${autoFolders.map((f) => f.id).join(',')})`);
  report.removed_auto_rows.push({ table: 'folders', why: 'created seconds earlier by the sign-up trigger for the new staging account', rows: autoFolders });
}
if (data.profiles.length) {
  const { user_id, ...rest } = ownProfile;
  await api('PATCH', `/rest/v1/profiles?user_id=eq.${me}`, { body: rest });
}

// 4. Rows, original ids and values
const strip = (r) => r; // rows are inserted exactly as exported
for (const def of TABLES) {
  const rows = data[def.t] ?? [];
  report.counts[def.t] = rows.length;
  for (let i = 0; i < rows.length; i += 200) await api('POST', `/rest/v1/${def.t}`, { body: rows.slice(i, i + 200).map(strip), headers: { prefer: 'return=minimal' } });
}
const readBack = async (t, ids) => {
  const out = [];
  for (let i = 0; i < ids.length; i += 150) out.push(...await api('GET', `/rest/v1/${t}?select=*&id=in.(${ids.slice(i, i + 150).join(',')})`));
  return Object.fromEntries(out.map((r) => [r.id, r]));
};
const same = (a, b) => canon(a) === canon(b) || (a != null && b != null && !Number.isNaN(Date.parse(a)) && typeof a === 'string' && /T\d\d:/.test(a) && Date.parse(a) === Date.parse(b));
for (const t of [...TABLES.map((d) => d.t), 'profiles']) {
  const rows = data[t] ?? [];
  if (!rows.length) continue;
  const got = t === 'profiles' ? Object.fromEntries((await api('GET', `/rest/v1/profiles?select=*&user_id=eq.${me}`)).map((r) => [r.id, r])) : await readBack(t, rows.map((r) => r.id));
  for (const r of rows) {
    const g = got[r.id];
    if (!g) { report.deviations.push({ table: t, id: r.id, problem: 'missing after insert' }); continue; }
    const diffCols = Object.keys(r).filter((c) => !same(r[c], g[c]));
    if (!diffCols.length) continue;
    // Restore what a trigger changed (e.g. a follow forced to "pending"); timestamps a trigger keeps setting are listed.
    const fix = Object.fromEntries(diffCols.map((c) => [c, r[c]]));
    await api('PATCH', `/rest/v1/${t}?id=eq.${r.id}`, { body: fix }).catch(() => {});
    const again = t === 'profiles' ? (await api('GET', `/rest/v1/profiles?select=*&user_id=eq.${me}`))[0] : (await readBack(t, [r.id]))[r.id];
    const still = diffCols.filter((c) => !same(r[c], again?.[c]));
    report.deviations.push({ table: t, id: r.id, changed_by_trigger: diffCols, restored: diffCols.filter((c) => !still.includes(c)), still_different: Object.fromEntries(still.map((c) => [c, { exported: r[c], staging: again?.[c] }])) });
  }
}

// 5. Photos, same bucket and path
for (const p of manifest.photos) {
  if (!p.sha256) { report.photos.push({ ...p, result: p.missing ? `not in export (${p.missing})` : 'external URL, left as stored' }); continue; }
  const buf = readFileSync(path.join(bundle, 'photos', p.bucket, p.path));
  if (sha256(buf) !== p.sha256) throw new Error(`photo changed since export: ${p.bucket}/${p.path}`);
  await api('POST', `/storage/v1/object/${p.bucket}/${p.path.split('/').map(encodeURIComponent).join('/')}`, { raw: buf, headers: { 'content-type': p.contentType || 'application/octet-stream', 'x-upsert': 'false' } });
  const signed = await api('POST', `/storage/v1/object/sign/${p.bucket}`, { body: { expiresIn: 120, paths: [p.path] } });
  const r = await fetch(URL0 + '/storage/v1' + signed[0].signedURL);
  const back = Buffer.from(await r.arrayBuffer());
  report.photos.push({ table: p.table, id: p.id, bucket: p.bucket, path: p.path, format: p.format, result: sha256(back) === p.sha256 ? 'uploaded, sha256 verified' : 'UPLOADED BUT DIFFERENT' });
}

// 6. Baseline snapshot for the after-testing comparison
const { snapshotStaging } = await import('./compare-staging.mjs');
const base = await snapshotStaging(api, manifest);
writeFileSync(path.join(bundle, 'staging-baseline.json'), JSON.stringify(base, null, 1));
report.finished_at = new Date().toISOString();
report.summary = {
  rows_inserted: Object.values(report.counts).reduce((a, b) => a + b, 0),
  rows_identical_to_export: Object.values(report.counts).reduce((a, b) => a + b, 0) - report.deviations.filter((d) => d.table !== 'profiles').length,
  rows_with_unrestorable_differences: report.deviations.filter((d) => d.problem || Object.keys(d.still_different ?? {}).length).length,
  photos_verified: report.photos.filter((p) => /verified/.test(p.result)).length,
  photos_total: manifest.photos.length,
};
writeFileSync(path.join(bundle, 'import-report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.summary, null, 1));
for (const d of report.deviations) console.log(`deviation: ${d.table} ${d.id} ${d.problem ?? `trigger changed ${d.changed_by_trigger.join(',')}; still different: ${Object.keys(d.still_different).join(',') || 'none'}`}`);
console.log(`\nSign in to "Afiyeat Staging" with ${stagingEmail}. Report: ${path.join(bundle, 'import-report.json')}`);
