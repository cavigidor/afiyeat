#!/usr/bin/env node
// Copies ONE account's own Afiyeat list data out of production, READ-ONLY, into a local folder,
// so it can be loaded into the approved staging project and opened in the "Afiyeat Staging" iPhone app.
//
//   node qa/compat/staging/export-own-data.mjs --out ~/AfiyeatStaging/export-2026-11-20
//
// It signs in as you (you type your email and password; neither is saved), then reads only what the
// app itself reads for you. It cannot write: every request goes through an allowlist that permits
// only sign-in, sign-out, GET reads, and creating short-lived signed links to download your own photos.
//
// What it copies (yours, unchanged): lists, statuses, categories, items, item photos, My Restaurants,
// folders, restaurant photos, your profile settings (no referral code, no avatar), your shared lists,
// your follows and blocks.
// What it never copies: passwords, tokens, device/push tokens, email codes, anyone's email address,
// other people's profiles, photos, notes or comments.
// Other people who appear in your data (shared-list partner, followers, blocked accounts) are replaced
// by unlinkable pseudonyms ("Member 1"); their shared-list places become "Place added by Member 1 #n"
// with no address, location or note, and their comments become "[comment by Member 1]".
import { mkdirSync, writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { TABLES, PROFILE_COLUMNS, storageLocation, sha256, canon, pseudonymiser, ask } from './lib/common.mjs';
import { PRODUCTION_URL, REPO } from './lib/target.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const out = arg('--out');
if (!out) { console.error('usage: export-own-data.mjs --out <new folder>'); process.exit(2); }
if (existsSync(out)) { console.error(`STOPPED: ${out} already exists. Use a new folder.`); process.exit(2); }

// Source: production by default (public URL + public publishable key from the repository's .env).
// EXPORT_SOURCE_URL / EXPORT_SOURCE_KEY exist only to rehearse against the local lab.
const lab = !!process.env.EXPORT_SOURCE_URL;
if (lab && !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.EXPORT_SOURCE_URL)) { console.error('EXPORT_SOURCE_URL is for the local lab only'); process.exit(2); }
const SRC = lab ? process.env.EXPORT_SOURCE_URL : PRODUCTION_URL;
// The app's PUBLIC publishable key: from the repository's .env, or public-app-config.env beside the tools.
const publicEnv = () => { for (const f of ['.env', 'public-app-config.env']) { try { return readFileSync(path.join(REPO, f), 'utf8'); } catch { /* next */ } } return ''; };
const KEY = lab ? process.env.EXPORT_SOURCE_KEY : (publicEnv().match(/^VITE_SUPABASE_PUBLISHABLE_KEY\s*=\s*"?([^"\n]+)"?/m) ?? [])[1];
if (!KEY) { console.error('no publishable key found in .env'); process.exit(2); }

// ---- read-only allowlist: the only way this script talks to the network ----
const sent = [];
async function call(method, p, { body, token, headers = {} } = {}) {
  const allowed =
    (method === 'POST' && p === '/auth/v1/token?grant_type=password') ||
    (method === 'POST' && p === '/auth/v1/logout') ||
    (method === 'GET' && p.startsWith('/rest/v1/')) ||
    (method === 'POST' && /^\/storage\/v1\/object\/sign\/[a-z0-9-]+$/.test(p)) ||
    (method === 'GET' && /^\/storage\/v1\/object\/sign\/[a-z0-9-]+\/.+\?token=/.test(p));
  if (!allowed) throw new Error(`BLOCKED (read-only export): ${method} ${p}`);
  sent.push(`${method} ${p.split('?')[0]}`);
  const r = await fetch(SRC + p, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { apikey: KEY, authorization: `Bearer ${token ?? KEY}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
  });
  if (!r.ok) throw new Error(`${method} ${p.split('?')[0]} -> HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r;
}

const email = lab ? process.env.EXPORT_EMAIL : await ask(`Afiyeat email (${new URL(SRC).host}): `);
const password = lab ? process.env.EXPORT_PASSWORD : await ask('Password (not shown, not saved): ', { hidden: true });
const s = await (await call('POST', '/auth/v1/token?grant_type=password', { body: { email, password } })).json();
const token = s.access_token, me = s.user.id;
console.log(`signed in as ${me}`);

async function readAll(table, filter) {
  const rows = [];
  for (let off = 0; ; off += 1000) {
    const r = await call('GET', `/rest/v1/${table}?select=*&${filter}&order=id.asc&limit=1000&offset=${off}`, { token });
    const page = await r.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

const P = pseudonymiser();
const other = (uuid) => (uuid === me || uuid == null ? uuid : P(uuid));
const data = {}, photos = [], notes = [];
const byId = (t) => new Set((data[t] ?? []).map((r) => r.id));
for (const def of TABLES) {
  let rows;
  if (def.own) rows = await readAll(def.t, `${def.own}=eq.${me}`);
  else if (def.member) rows = await readAll(def.t, `or=(${def.member.map((c) => `${c}.eq.${me}`).join(',')})`);
  else if (def.byList) { const ids = [...byId(def.byList)]; rows = ids.length ? await readAll(def.t, `list_id=in.(${ids.join(',')})`) : []; }
  // Pseudonymise and redact other people.
  rows = rows.map((r) => {
    const o = { ...r };
    for (const c of [...(def.member ?? []), ...(def.other ?? [])]) o[c] = other(o[c]);
    if (def.author && o[def.author] !== me) {
      o[def.author] = other(o[def.author]);
      const label = P.label(r[def.author]);
      if (def.t === 'shared_list_items') Object.assign(o, { name: `Place added by ${label} #${(o.id ?? '').slice(0, 4)}`, address: null, latitude: null, longitude: null, notes: null, apple_place_id: null });
      if (def.t === 'shared_list_item_comments') o.comment = `[comment by ${label}]`;
    }
    return o;
  });
  data[def.t] = rows;
  if (def.photo) for (const r of rows) photos.push({ table: def.t, id: r.id, value: r[def.photo.col], ...storageLocation(r[def.photo.col], def.photo.bucket) });
  console.log(`  ${def.t.padEnd(26)} ${rows.length}`);
}
// Own profile (selected columns only) + the privacy flag of each pseudonymous member.
const prof = (await readAll('profiles', `user_id=eq.${me}`))[0];
data.profiles = prof ? [Object.fromEntries(PROFILE_COLUMNS.map((c) => [c, prof[c] ?? null]))] : [];
// Each pseudonymous member's is_private flag (needed to test privacy); nothing else about them is kept.
// The pseudonymiser can't be reversed, so the membership rows are read again for the real ids.
const raw = [
  ...(await readAll('shared_lists', `or=(user_a.eq.${me},user_b.eq.${me})`)).flatMap((r) => [r.user_a, r.user_b]),
  ...(await readAll('follows', `or=(follower_id.eq.${me},following_id.eq.${me})`)).flatMap((r) => [r.follower_id, r.following_id]),
  ...(await readAll('blocked_users', `blocker_id=eq.${me}`)).map((r) => r.blocked_id),
].filter((u) => u && u !== me);
const privacy = new Map();
for (const u of new Set(raw)) {
  const p = await (await call('GET', `/rest/v1/profiles?select=is_private&user_id=eq.${u}`, { token })).json();
  privacy.set(P(u), p[0] ? !!p[0].is_private : null);
}
const members = P.all().map((m) => ({ id: m.id, label: `Member ${m.n}`, is_private: privacy.get(m.id) ?? null }));

// Photos: download your own through short-lived signed links.
mkdirSync(path.join(out, 'photos'), { recursive: true });
chmodSync(out, 0o700);
const byBucket = {};
for (const p of photos) if (p.bucket && p.path) (byBucket[p.bucket] ??= []).push(p);
for (const [bucket, list] of Object.entries(byBucket)) {
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const signed = await (await call('POST', `/storage/v1/object/sign/${bucket}`, { token, body: { expiresIn: 600, paths: chunk.map((p) => p.path) } })).json();
    for (const [j, sres] of signed.entries()) {
      const p = chunk[j];
      if (!sres.signedURL) { p.missing = sres.error ?? 'not signed'; notes.push(`photo ${bucket}/${p.path}: ${p.missing}`); continue; }
      try {
        const r = await call('GET', `/storage/v1${sres.signedURL}`);
        const buf = Buffer.from(await r.arrayBuffer());
        const f = path.join(out, 'photos', bucket, p.path);
        mkdirSync(path.dirname(f), { recursive: true });
        writeFileSync(f, buf);
        Object.assign(p, { bytes: buf.length, sha256: sha256(buf), contentType: r.headers.get('content-type') });
      } catch (e) { p.missing = e.message; notes.push(`photo ${bucket}/${p.path}: ${e.message}`); }
    }
  }
}
for (const p of photos) if (!p.bucket) notes.push(`photo on ${p.table} ${p.id} is an external URL; left as is`);
await call('POST', '/auth/v1/logout', { token }).catch(() => {});

const manifest = {
  kind: 'afiyeat-own-data-export', version: 1, exported_at: new Date().toISOString(), source: new URL(SRC).host,
  account: me,
  columns: Object.fromEntries(Object.entries(data).map(([t, rows]) => [t, [...new Set(rows.flatMap((r) => Object.keys(r)))]])),
  counts: Object.fromEntries(Object.entries(data).map(([t, r]) => [t, r.length])),
  row_hashes: Object.fromEntries(Object.entries(data).map(([t, rows]) => [t, Object.fromEntries(rows.map((r) => [r.id ?? r.user_id, sha256(canon(r))]))])),
  photos, members, notes,
  requests: [...new Set(sent)],
  redaction: 'other people pseudonymised (unlinkable); their shared-list places and comments replaced; no credentials, tokens, emails or other profiles',
};
writeFileSync(path.join(out, 'data.json'), JSON.stringify(data, null, 1));
writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
writeFileSync(path.join(out, 'CONTAINS-YOUR-PRIVATE-DATA.txt'), 'This folder holds your own Afiyeat lists and photos. Keep it on this Mac; delete it when the staging test is done.\n');
console.log(`\nexported to ${out}`);
console.log(`photos: ${photos.filter((p) => p.sha256).length} downloaded, ${photos.filter((p) => p.missing).length} missing, ${photos.filter((p) => !p.bucket).length} external`);
console.log(`requests made (all read-only): ${manifest.requests.length} distinct`);
for (const n of notes) console.log(`note: ${n}`);
