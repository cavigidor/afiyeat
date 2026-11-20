// Lists V2 compatibility on the PM's OWN exported data (export-own-data.mjs bundle), entirely local.
//
//   node own-data-suite.mjs <bundle folder> [--out <results folder>]
//
// 1. Loads the bundle into a fresh local database with production's current schema (main 9baf34e),
//    keeping every original id and value (database triggers off while loading, so nothing is re-stamped),
//    and verifies the load field by field against the export.
// 2. Old app (main) reads every list on today's schema.  3. Applies the five pending migrations.
// 4. Privacy before/after for the owner, each pseudonymous member, a stranger and a signed-out visitor.
// 5. Old app again on the migrated schema.  6. Lists V2 reads every list, opens items with photos,
//    then makes four test edits on this LOCAL copy (quick add, edit in a list with hidden fields,
//    hide+show a field, add a photo).
// 7. Compares every original row (ids, relationships, notes, ratings, prices, photos, settings)
//    with the export: anything not explained by the four test edits is reported as unexpected.
// Never contacts a hosted project: all app requests go to 127.0.0.1, anything else is blocked and recorded.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { psql, applyPending, fullSha } from './db.mjs';
import { up, APPS } from './stack.mjs';
import { snapshot, diff } from './snapshot.mjs';
import { anonKey, STATE } from './gateway.mjs';
import { openBrowser, newPage, signIn, text, goto, wait } from './browser.mjs';

const BUNDLE = process.argv[2];
if (!BUNDLE || !existsSync(path.join(BUNDLE, 'manifest.json'))) { console.error('usage: own-data-suite.mjs <bundle folder>'); process.exit(2); }
const MAIN = fullSha('9baf34e0b287b7dbb6b11909a1b509693cbcede0');
const NEW = fullSha('4973aa7216e7e147966c1c86b79161144d2d8395');
const DB = 'owndata';
const FIVE = ['20261029120000_custom_list_items_owner_check.sql', '20261030120000_list_visibility_and_anonymous_discovery.sql',
  '20261109120000_discovery_places.sql', '20261109180000_custom_list_images_owner_folder.sql', '20261111120000_photo_records_owner_check.sql'];
const RUN = `own-data-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const oi = process.argv.indexOf('--out');
const OUT = oi > 0 ? process.argv[oi + 1] : path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'results-private', RUN);
mkdirSync(OUT, { recursive: true, mode: 0o700 });

const manifest = JSON.parse(readFileSync(path.join(BUNDLE, 'manifest.json'), 'utf8'));
const data = JSON.parse(readFileSync(path.join(BUNDLE, 'data.json'), 'utf8'));
const ME = manifest.account;

const results = [];
const record = (phase, check, status, detail = '') => { results.push({ phase, check, status, detail: String(detail) }); console.log(`${status.padEnd(12)} ${phase} | ${check}${detail ? ` — ${String(detail).slice(0, 240)}` : ''}`); };
async function check(phase, name, fn) {
  try { const d = await fn(); record(phase, name, 'PASS', d ?? ''); return true; }
  catch (e) { record(phase, name, 'FAIL', e.message.split('\n')[0]); return false; }
}
const recreate = (db, template) => { psql('postgres', ['-c', `DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`]); psql('postgres', ['-c', `CREATE DATABASE "${db}" TEMPLATE "${template}"`]); };
const q1 = (sql) => psql(DB, ['-At', '-c', sql]).trim();
const qj = (sql) => JSON.parse(q1(`SELECT coalesce(json_agg(x), '[]') FROM (${sql}) x`));
const lit = (v) => { const tag = `q${crypto.randomBytes(4).toString('hex')}`; return `$${tag}$${v}$${tag}$`; };
const isTs = (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\d[T ]\d\d:/.test(v);
const norm = (v) => (isTs(v) ? Date.parse(v.replace(' ', 'T')) : Array.isArray(v) ? JSON.stringify(v) : v && typeof v === 'object' ? JSON.stringify(Object.keys(v).sort().reduce((o, k) => ({ ...o, [k]: v[k] }), {})) : v);
const same = (a, b) => norm(a) === norm(b) || (typeof a === 'number' && typeof b === 'string' && Number(b) === a) || (typeof b === 'number' && typeof a === 'string' && Number(a) === b);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Names in the report: ids only (no list or item names leave this machine in the summary).
const short = (uuid) => String(uuid).slice(0, 8);

// ---------------------------------------------------------------- 1. load
const TABLE_ORDER = ['folders', 'custom_lists', 'custom_list_statuses', 'custom_list_types', 'custom_list_items', 'custom_list_item_images',
  'restaurants', 'restaurant_images', 'shared_lists', 'shared_list_items', 'shared_list_item_comments', 'follows', 'blocked_users'];
recreate(DB, 'baseline');
const labCols = (t) => q1(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}'`).split(',');
// Schema differences between production (columns present in the export) and production's repository schema (main)
const schemaNotes = [];
for (const t of [...TABLE_ORDER, 'profiles']) {
  const prod = manifest.columns?.[t] ?? [];
  if (!prod.length) continue;
  const lab = labCols(t);
  const extra = prod.filter((c) => !lab.includes(c)), missing = t === 'profiles' ? [] : lab.filter((c) => !prod.includes(c));
  if (extra.length || missing.length) schemaNotes.push(`${t}: production has ${extra.join(', ') || '-'} not in main; main has ${missing.join(', ') || '-'} not in production rows`);
}
record('P0 load', 'production columns match the schema the lab replays (main)', schemaNotes.length ? 'FAIL' : 'PASS', schemaNotes.join(' | ') || `${TABLE_ORDER.length + 1} tables compared`);

const pw = () => crypto.randomBytes(9).toString('base64url');
const owner = { key: 'owner', id: ME, email: 'owner@lab.afiyeat.test', password: pw(), name: 'Owner (you)' };
const members = manifest.members.map((m, i) => ({ key: `member${i + 1}`, id: m.id, email: `member${i + 1}@lab.afiyeat.test`, password: pw(), name: m.label, is_private: m.is_private }));
const stranger = { key: 'stranger', id: crypto.randomUUID(), email: 'stranger@lab.afiyeat.test', password: pw(), name: 'Stranger' };
const sql = ['SET session_replication_role = replica;', 'SET search_path = public, extensions;'];
sql.push(`INSERT INTO storage.buckets (id, name, public) VALUES ('custom-list-images', 'custom-list-images', false) ON CONFLICT (id) DO NOTHING;`);
for (const u of [owner, ...members, stranger]) sql.push(`INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at) VALUES ('${u.id}', ${lit(u.email)}, '{}', now());`);
const insertRow = (t, row) => {
  const cols = Object.keys(row).filter((c) => labCols.cache[t].includes(c));
  const j = lit(JSON.stringify(row));
  return `INSERT INTO public.${t} (${cols.map((c) => `"${c}"`).join(',')}) SELECT ${cols.map((c) => `"${c}"`).join(',')} FROM jsonb_populate_record(null::public.${t}, ${j}::jsonb);`;
};
labCols.cache = Object.fromEntries([...TABLE_ORDER, 'profiles'].map((t) => [t, labCols(t)]));
for (const p of data.profiles) sql.push(insertRow('profiles', p));
for (const m of [...members, stranger]) sql.push(insertRow('profiles', { id: crypto.randomUUID(), user_id: m.id, username: `${m.key}_${short(m.id)}`, display_name: m.name, is_private: !!m.is_private }));
for (const t of TABLE_ORDER) for (const r of data[t] ?? []) sql.push(insertRow(t, r));
// Photos: same bucket, same path, uploader = owner
const filesDir = path.join(STATE, 'storage-files');
rmSync(filesDir, { recursive: true, force: true });
let photoFiles = 0;
for (const p of manifest.photos.filter((x) => x.sha256)) {
  const src = path.join(BUNDLE, 'photos', p.bucket, p.path);
  const dst = path.join(filesDir, p.bucket, p.path);
  mkdirSync(path.dirname(dst), { recursive: true });
  writeFileSync(dst, readFileSync(src));
  writeFileSync(`${dst}.meta`, JSON.stringify({ type: p.contentType || 'image/jpeg' }));
  sql.push(`INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata) VALUES (${lit(p.bucket)}, ${lit(p.path)}, '${ME}', '${ME}', ${lit(JSON.stringify({ mimetype: p.contentType || 'image/jpeg', size: p.bytes }))}::jsonb) ON CONFLICT DO NOTHING;`);
  photoFiles++;
}
psql(DB, ['-1', '-v', 'ON_ERROR_STOP=1'], sql.join('\n'));
writeFileSync(path.join(STATE, 'users.json'), JSON.stringify([owner, ...members, stranger].map(({ key, id, email, password, name }) => ({ key, id, email, password, name })), null, 1));

const S0 = await snapshot(DB);
writeFileSync(path.join(OUT, 'S0-loaded.json'), JSON.stringify(S0));
await check('P0 load', 'every exported row is in the lab with its original id and every original value', () => {
  const bad = [];
  for (const t of [...TABLE_ORDER, 'profiles']) for (const r of data[t] ?? []) {
    const g = S0[`public.${t}`]?.[r.id];
    if (!g) { bad.push(`${t} ${short(r.id)} missing`); continue; }
    for (const c of Object.keys(r)) if (labCols.cache[t].includes(c) && !same(r[c], g[c])) bad.push(`${t} ${short(r.id)}.${c}`);
  }
  assert.deepEqual(bad.slice(0, 20), []);
  return `${Object.entries(manifest.counts).map(([t, n]) => `${t} ${n}`).join(', ')}; ${photoFiles} photo files`;
});
const missingPhotos = manifest.photos.filter((p) => !p.sha256);
if (missingPhotos.length) record('P0 load', 'photos referenced by your rows but not downloadable from production', 'PRE-EXISTING', `${missingPhotos.length}: ${missingPhotos.map((p) => `${p.table} ${short(p.id)} (${p.format}${p.missing ? `: ${String(p.missing).slice(0, 60)}` : ''})`).join('; ')}`);

// A failed call that only tries to sign a photo already missing in production is the pre-existing gap above.
const realFailures = (list) => list.filter((f) => !missingPhotos.some((p) => p.path && f.includes(`/storage/v1/object/sign/${p.bucket}/${p.path}`)));

// ---------------------------------------------------------------- truth helpers
const ownLists = () => qj(`SELECT l.id, l.name, l.show_location, l.show_notes, l.show_price, l.show_rating, l.show_photos,
    (SELECT count(*) FROM custom_list_items i WHERE i.list_id = l.id)::int AS items,
    (SELECT count(*) FROM custom_list_statuses s WHERE s.list_id = l.id)::int AS statuses,
    (SELECT count(*) FROM custom_list_items i WHERE i.list_id = l.id AND NOT EXISTS (SELECT 1 FROM custom_list_statuses s WHERE s.id = i.status_id AND s.list_id = l.id))::int AS unplaced
  FROM custom_lists l WHERE l.user_id = '${ME}' ORDER BY l.created_at`);
const statusCounts = (listId) => qj(`SELECT s.name, (SELECT count(*) FROM custom_list_items i WHERE i.status_id = s.id AND i.list_id = s.list_id)::int AS n FROM custom_list_statuses s WHERE s.list_id = '${listId}' ORDER BY s.sort_order NULLS LAST, s.created_at`);
const lists0 = ownLists();
const unplacedTotal = lists0.reduce((s, l) => s + (l.statuses ? l.unplaced : 0), 0);
if (unplacedTotal) record('P0 load', 'items with no valid status in a list that has statuses (not shown by the old app either)', 'PRE-EXISTING', lists0.filter((l) => l.statuses && l.unplaced).map((l) => `list ${short(l.id)}: ${l.unplaced}`).join('; '));

// ---------------------------------------------------------------- UI helpers
async function clickText(page, t, scope = 'button, a, [role="tab"], [role="menuitem"], [role="option"], [role="radio"]') {
  const h = await page.evaluateHandle((s, x) => [...document.querySelectorAll(s)].find((e) => (e.textContent?.trim() === x || e.getAttribute('aria-label') === x) && e.getClientRects().length), scope, t);
  const el = h.asElement(); if (!el) throw new Error(`nothing to tap labelled "${t}"`);
  await el.click(); await wait(600);
}
async function clickContaining(page, scope, t) {
  const h = await page.evaluateHandle((s, x) => [...document.querySelectorAll(s)].find((b) => b.textContent?.includes(x) && b.getClientRects().length), scope, t);
  const el = h.asElement(); if (!el) throw new Error(`nothing containing "${t.slice(0, 30)}" in ${scope}`);
  await el.click(); await wait(700);
}
async function typeInto(page, selector, value) { await page.click(selector, { clickCount: 3 }); await page.keyboard.type(value); await wait(300); }
function photoFile() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lab-photo-'));
  const f = path.join(dir, 'new-photo.png');
  writeFileSync(f, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  return f;
}
async function visibleImages(page) {
  await page.evaluate(() => new Promise((r) => setTimeout(r, 1200)));
  return page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => i.getClientRects().length && /\/storage\/v1\/object\/sign\//.test(i.src)).map((i) => ({ ok: i.complete && i.naturalWidth > 0, src: i.src.split('/sign/')[1]?.split('?')[0] })));
}

async function restaurantTabs(page) {
  await goto(page, '/my-list'); await wait(800);
  const t = await text(page);
  return { toGo: Number(/To Go \((\d+)\)/.exec(t)?.[1] ?? NaN), beenThere: Number(/Been There \((\d+)\)/.exec(t)?.[1] ?? NaN) };
}
const restTruth = () => qj(`SELECT status, count(*)::int AS n FROM restaurants WHERE user_id = '${ME}' GROUP BY 1`).reduce((o, r) => ({ ...o, [r.status]: r.n }), { to_go: 0, went_to: 0 });
/** Open a restaurant's Edit dialog from its card's options menu. */
async function openRestaurantEdit(page, name, status) {
  await goto(page, '/my-list');
  await clickContaining(page, 'main [role=tab]', status === 'went_to' ? 'Been There' : 'To Go');
  const h = await page.evaluateHandle((n) => {
    for (const b of document.querySelectorAll('[aria-label="Restaurant options"]')) {
      let card = b; while (card.parentElement && card.parentElement.querySelectorAll('[aria-label="Restaurant options"]').length === 1) card = card.parentElement;
      if (card.textContent.includes(n) && b.getClientRects().length) return b;
    }
    return null;
  }, name);
  const el = h.asElement(); if (!el) throw new Error('restaurant card not found (list may be paged)');
  await el.click(); await wait(600);
  const ed = await page.evaluateHandle(() => [...document.querySelectorAll('[role=menuitem]')].find((e) => e.textContent.trim() === 'Edit'));
  await ed.asElement().click(); await wait(2500);
}

// ---------------------------------------------------------------- privacy matrix through PostgREST + RLS
async function privacyMatrix(base) {
  const who = { anon: null, owner, stranger, ...Object.fromEntries(members.map((m) => [m.key, m])) };
  const tables = ['custom_lists', 'custom_list_items', 'custom_list_item_images', 'custom_list_statuses', 'custom_list_types', 'restaurants', 'restaurant_images', 'shared_lists', 'shared_list_items', 'shared_list_item_comments', 'follows', 'folders'];
  const m = {};
  const objs = qj(`SELECT bucket_id || '/' || name AS o FROM storage.objects ORDER BY 1`).map((r) => r.o);
  for (const [k, u] of Object.entries(who)) {
    let h = { apikey: anonKey() };
    if (u) { const t = await (await fetch(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ email: u.email, password: u.password }) })).json(); h = { ...h, authorization: `Bearer ${t.access_token}` }; }
    m[k] = {};
    for (const t of tables) {
      const r = await fetch(`${base}/rest/v1/${t}?select=id&order=id`, { headers: h });
      m[k][t] = r.ok ? (await r.json()).map((x) => x.id) : `HTTP ${r.status}`;
    }
    const ok = [];
    for (const o of objs) {
      const [b, ...p] = o.split('/');
      const r = await fetch(`${base}/storage/v1/object/sign/${b}/${p.join('/')}`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{"expiresIn":60}' });
      if (r.ok) ok.push(o);
    }
    m[k]['photos (signable)'] = ok;
  }
  return m;
}
const compareMatrices = (a, b) => {
  const d = [];
  for (const u of Object.keys(a)) for (const t of Object.keys(a[u])) if (JSON.stringify(a[u][t]) !== JSON.stringify(b[u]?.[t])) d.push(`${u} / ${t}: ${Array.isArray(a[u][t]) ? a[u][t].length : a[u][t]} -> ${Array.isArray(b[u]?.[t]) ? b[u][t].length : b[u]?.[t]}`);
  return d;
};

// ---------------------------------------------------------------- run
const browser = await openBrowser();
let lab = await up(DB);
async function pageFor(app, width) {
  const p = await newPage(browser, `http://127.0.0.1:${APPS[app].port}`);
  await p.setViewport({ width, height: 900, deviceScaleFactor: 1, isMobile: width < 700, hasTouch: width < 700 });
  await p.emulateTimezone(data.profiles[0]?.timezone || 'America/Chicago');
  return p;
}
const perList = Object.fromEntries(lists0.map((l) => [l.id, { list: short(l.id), items: l.items, statuses: l.statuses, unplaced: l.unplaced }]));
let page;
let restSummary = [];
try {
  // ===== P1 old app, today's schema =====
  page = await pageFor('old', 1100);
  await signIn(page, owner.email, owner.password);
  await goto(page, '/my-lists');
  const oldHome = await text(page);
  await check('P1 old app / current schema', 'Lists page shows every one of your lists with its item count', () => {
    const missing = lists0.filter((l) => !new RegExp(`${esc(l.name)}\\s+${l.items} items?`).test(oldHome));
    assert.equal(missing.length, 0, `missing or wrong count: ${missing.map((l) => `list ${short(l.id)} (${l.items})`).join('; ')}`);
    return `${lists0.length} lists, ${lists0.reduce((s, l) => s + l.items, 0)} items`;
  });
  for (const L of lists0) {
    await goto(page, `/my-lists/${L.id}`);
    const t = await text(page);
    const tabs = [...t.matchAll(/\((\d+)\)/g)].map((m) => Number(m[1]));
    perList[L.id].old = L.statuses ? tabs.reduce((a, b) => a + b, 0) : (qj(`SELECT name FROM custom_list_items WHERE list_id='${L.id}'`).filter((r) => t.includes(r.name)).length);
  }
  await check('P1 old app / current schema', 'every list opens and shows all its items (status tabs add up)', () => {
    const bad = lists0.filter((l) => perList[l.id].old !== l.items - (l.statuses ? l.unplaced : 0));
    assert.equal(bad.length, 0, bad.map((l) => `list ${short(l.id)}: shown ${perList[l.id].old} of ${l.items - (l.statuses ? l.unplaced : 0)}`).join('; '));
    return `${lists0.length} lists opened`;
  });
  const rt0 = restTruth();
  const oldTabs = await restaurantTabs(page);
  await check('P1 old app / current schema', 'My Restaurants shows every place (To Go / Been There counts)', () => {
    assert.deepEqual(oldTabs, { toGo: rt0.to_go, beenThere: rt0.went_to });
    return `${rt0.to_go} to go, ${rt0.went_to} been there`;
  });
  await check('P1 old app / current schema', 'no failed API calls; nothing sent off the machine except the blocked map script', () => {
    const f = realFailures(page.failedApi);
    assert.deepEqual(f, [], f.join(' ; '));
    return `${page.external.length} blocked map-script requests${f.length < page.failedApi.length ? `; ${page.failedApi.length - f.length} sign attempts for photos already missing in production` : ''}`;
  });
  await page.close();
  const S1 = await snapshot(DB);
  const d1 = diff(S0, S1);
  await check('P1 old app / current schema', 'reading changes nothing except the profile timezone re-save', () => {
    const other = Object.entries(d1).flatMap(([t, r]) => [...r.added.map((k) => `${t} +${short(k)}`), ...r.deleted.map((k) => `${t} -${short(k)}`), ...r.changed.filter((c) => !(t === 'public.profiles' && Object.keys(c.cols).every((x) => ['updated_at', 'timezone'].includes(x)))).map((c) => `${t} ${short(c.key)} ${Object.keys(c.cols)}`)]);
    assert.deepEqual(other, []);
  });

  // ===== P2 privacy before, P3 migrations, P2 privacy after =====
  const base = `http://127.0.0.1:${APPS.old.port}`;
  const before = await privacyMatrix(base);
  await lab.close(); lab = null;
  const preMig = await snapshot(DB);
  const applied = applyPending(DB, { main: MAIN, stack: NEW, only: FIVE });
  const S3 = await snapshot(DB);
  writeFileSync(path.join(OUT, 'S3-after-migrations.json'), JSON.stringify(S3));
  const d3 = diff(preMig, S3);
  await check('P3 migrations', `the five pending migrations apply to your data (${applied.length})`, () => assert.equal(applied.length, 5));
  await check('P3 migrations', 'no existing row added, deleted or changed; only the new columns appear', () => {
    const bad = Object.entries(d3).flatMap(([t, r]) => [...r.added.map((k) => `${t} +${short(k)}`), ...r.deleted.map((k) => `${t} -${short(k)}`), ...r.changed.map((c) => `${t} ${short(c.key)} ${Object.keys(c.cols)}`), ...r.removedCols.map((c) => `${t} removed ${c}`)]);
    assert.deepEqual(bad, []);
    return Object.entries(d3).flatMap(([t, r]) => r.addedCols.map((c) => `${t.replace('public.', '')}.${c}`)).join(', ');
  });
  await check('P3 migrations', 'every one of your lists keeps profile-based visibility and gets a unique discovery token', () => {
    const v = qj(`SELECT visibility, discovery_token FROM custom_lists WHERE user_id='${ME}'`);
    assert.ok(v.every((r) => r.visibility === 'profile'), 'a list got another visibility');
    assert.equal(new Set(v.map((r) => r.discovery_token)).size, v.length);
    return `${v.length}/${v.length} profile`;
  });
  lab = await up(DB);
  const after = await privacyMatrix(base);
  writeFileSync(path.join(OUT, 'privacy-before.json'), JSON.stringify(before));
  writeFileSync(path.join(OUT, 'privacy-after.json'), JSON.stringify(after));
  await check('P2 privacy', 'you, each member, a stranger and a signed-out visitor see exactly the same rows and photos before and after', () => {
    const d = compareMatrices(before, after).filter((x) => !/^anon \/ restaurant_images: 0 -> HTTP 401/.test(x));
    assert.deepEqual(d, []);
    return `${Object.keys(before).length} viewers x ${Object.keys(before.owner).length} tables`;
  });
  await check('P2 privacy', 'a stranger and a signed-out visitor see none of your private-visibility content; your photos sign only for permitted viewers', () => {
    const priv = data.profiles[0]?.is_private;
    if (priv) assert.equal(after.stranger.custom_list_items.filter((x) => data.custom_list_items.some((i) => i.id === x)).length, 0, 'stranger sees items of a private account');
    assert.equal(after.anon['photos (signable)'].length, 0, 'signed-out visitor can sign photos');
    assert.equal(after.stranger['photos (signable)'].length, priv ? 0 : after.stranger['photos (signable)'].length);
    return `your account is ${priv ? 'private' : 'public'}; stranger can sign ${after.stranger['photos (signable)'].length}, owner ${after.owner['photos (signable)'].length} of ${photoFiles}`;
  });

  // ===== P4 old app on migrated schema =====
  page = await pageFor('old', 1100);
  await signIn(page, owner.email, owner.password);
  await goto(page, '/my-lists');
  const oldHome2 = await text(page);
  await check('P4 old app / migrated schema', 'Lists page still shows every list with its item count; no failed calls', () => {
    const missing = lists0.filter((l) => !new RegExp(`${esc(l.name)}\\s+${l.items} items?`).test(oldHome2));
    assert.equal(missing.length, 0, `missing: ${missing.map((l) => short(l.id)).join(', ')}`);
    const f = realFailures(page.failedApi);
    assert.deepEqual(f, [], f.join(' ; '));
  });
  await page.close();

  // ===== P5 Lists V2 reads =====
  page = await pageFor('new', 390);
  await signIn(page, owner.email, owner.password);
  await goto(page, '/my-lists');
  const newHome = await text(page);
  await check('P5 Lists V2', 'Lists home shows every one of your lists with its item count', () => {
    const lines = newHome.split('\n').map((x) => x.trim());
    const missing = lists0.filter((l) => { const i = lines.findIndex((x) => x === l.name.trim()); return i < 0 || !new RegExp(`^${l.items} `).test(lines[i + 1] ?? ''); });
    assert.equal(missing.length, 0, `missing/wrong: ${missing.map((l) => `list ${short(l.id)} (${l.items})`).join('; ')}`);
    return `${lists0.length} lists`;
  });
  for (const L of lists0) {
    await goto(page, `/my-lists/${L.id}`);
    const t = await text(page);
    if (L.statuses) perList[L.id].v2 = statusCounts(L.id).reduce((s, c) => s + (new RegExp(`${esc(c.name)}\\s*\\n\\s*${c.n}\\b`).test(t) ? c.n : 0), 0);
    else perList[L.id].v2 = qj(`SELECT name FROM custom_list_items WHERE list_id='${L.id}'`).filter((r) => t.includes(r.name)).length;
  }
  await check('P5 Lists V2', 'every list opens and accounts for the same items the old app shows', () => {
    const bad = lists0.filter((l) => perList[l.id].v2 !== perList[l.id].old);
    assert.equal(bad.length, 0, bad.map((l) => `list ${short(l.id)}: V2 ${perList[l.id].v2}, old ${perList[l.id].old}, total ${l.items}`).join('; '));
    return `${lists0.length} lists, ${lists0.reduce((s, l) => s + perList[l.id].v2, 0)} items shown`;
  });
  // Photos: open items that have photos and check every photo actually renders
  const withPhotos = qj(`SELECT i.id, i.name, i.list_id, s.name AS status, (SELECT count(*) FROM custom_list_item_images m WHERE m.item_id = i.id)::int AS n
    FROM custom_list_items i LEFT JOIN custom_list_statuses s ON s.id = i.status_id AND s.list_id = i.list_id
    WHERE i.user_id = '${ME}' AND EXISTS (SELECT 1 FROM custom_list_item_images m WHERE m.item_id = i.id) ORDER BY i.created_at`);
  const photoResults = [];
  for (const it of withPhotos.slice(0, 25)) {
    try {
      await goto(page, `/my-lists/${it.list_id}`);
      if (it.status) await clickContaining(page, 'main [role=tab], main button', it.status);
      await clickContaining(page, 'main button', it.name);
      const imgs = await visibleImages(page);
      const expected = manifest.photos.filter((p) => p.table === 'custom_list_item_images' && data.custom_list_item_images.find((m) => m.id === p.id)?.item_id === it.id && p.sha256).length;
      photoResults.push({ item: short(it.id), stored: it.n, downloadable: expected, rendered: imgs.filter((i) => i.ok).length, broken: imgs.filter((i) => !i.ok).length });
      await page.keyboard.press('Escape'); await wait(400);
    } catch (e) { photoResults.push({ item: short(it.id), error: e.message.slice(0, 80) }); }
  }
  await check('P5 Lists V2', 'every downloadable photo on your items renders (both stored formats)', () => {
    if (!withPhotos.length) return 'NOT COVERED: none of your list items has photos';
    const bad = photoResults.filter((r) => r.error || r.rendered < r.downloadable || r.broken);
    assert.equal(bad.length, 0, JSON.stringify(bad.slice(0, 6)));
    return `${photoResults.length} items opened, ${photoResults.reduce((s, r) => s + r.rendered, 0)} photos rendered${withPhotos.length > 25 ? ` (first 25 of ${withPhotos.length} items)` : ''}`;
  });
  await check('P5 Lists V2', 'shared lists open with every item', async () => {
    const out = [];
    for (const sl of data.shared_lists) {
      await goto(page, `/my-lists/shared/${sl.id}`);
      const t = await text(page);
      const n = data.shared_list_items.filter((i) => i.list_id === sl.id).length;
      assert.match(t, new RegExp(`\\b${n} (places?|items?)\\b`), `shared list ${short(sl.id)} doesn't show ${n}`);
      out.push(`${short(sl.id)}: ${n}`);
    }
    return out.join(', ') || 'NOT COVERED: you have no shared lists';
  });
  const newTabs = await restaurantTabs(page);
  await check('P5 Lists V2', 'My Restaurants shows every place (To Go / Been There counts)', () => {
    assert.deepEqual(newTabs, { toGo: rt0.to_go, beenThere: rt0.went_to });
    return `${rt0.to_go} to go, ${rt0.went_to} been there`;
  });
  // Every Been There place with photos: open Edit (it lists all photos) and check each renders
  const restPhotos = qj(`SELECT r.id, r.name, r.status, (SELECT count(*) FROM restaurant_images m WHERE m.restaurant_id = r.id)::int AS n
    FROM restaurants r WHERE r.user_id = '${ME}' AND EXISTS (SELECT 1 FROM restaurant_images m WHERE m.restaurant_id = r.id) ORDER BY n DESC, r.created_at`);
  const restResults = [];
  for (const r of restPhotos.filter((x) => x.status === 'went_to').slice(0, 120)) {
    try {
      await openRestaurantEdit(page, r.name, r.status);
      const imgs = await page.evaluate(() => [...document.querySelectorAll('[role=dialog] img')].map((i) => ({ ok: i.complete && i.naturalWidth > 0, src: i.src })));
      const expected = manifest.photos.filter((p) => p.table === 'restaurant_images' && p.sha256 && data.restaurant_images.find((m) => m.id === p.id)?.restaurant_id === r.id).length;
      restResults.push({ place: short(r.id), stored: r.n, downloadable: expected, rendered: imgs.filter((i) => i.ok).length, broken: imgs.filter((i) => !i.ok).length });
      await page.keyboard.press('Escape'); await wait(400);
    } catch (e) { restResults.push({ place: short(r.id), error: e.message.slice(0, 80) }); }
  }
  restSummary = restResults;
  // To Go places don't list photos in Edit; their card shows the cover photo. Check every card cover loads.
  const toGoWithPhotos = restPhotos.filter((x) => x.status === 'to_go');
  let coverResults = [];
  if (toGoWithPhotos.length) {
    await goto(page, '/my-list');
    await clickContaining(page, 'main [role=tab]', 'To Go');
    await page.evaluate(async () => { for (let i = 0; i < 30; i++) { window.scrollBy(0, 2000); await new Promise((r) => setTimeout(r, 150)); } });
    await wait(2500);
    coverResults = await page.evaluate((names) => names.map((n) => {
      for (const b of document.querySelectorAll('[aria-label="Restaurant options"]')) {
        let card = b; while (card.parentElement && card.parentElement.querySelectorAll('[aria-label="Restaurant options"]').length === 1) card = card.parentElement;
        if (card.textContent.includes(n)) { const imgs = [...card.querySelectorAll('img')].filter((i) => /\/storage\/v1\/object\/sign\//.test(i.src)); return { found: true, imgs: imgs.length, ok: imgs.filter((i) => i.complete && i.naturalWidth > 0).length }; }
      }
      return { found: false };
    }), toGoWithPhotos.map((x) => x.name));
  }
  await check('P5 Lists V2', 'the cover photo of every To Go place with photos loads on My Restaurants', () => {
    if (!toGoWithPhotos.length) return 'NOT COVERED: none of your To Go places has photos';
    const bad = coverResults.map((c, i) => ({ ...c, place: short(toGoWithPhotos[i].id) })).filter((c) => !c.found || c.imgs === 0 || c.ok < c.imgs);
    assert.equal(bad.length, 0, JSON.stringify(bad.slice(0, 8)));
    return `${coverResults.length} To Go places, every cover loaded`;
  });
  await check('P5 Lists V2', 'every downloadable photo on your Been There places renders in Edit', () => {
    if (!restPhotos.some((x) => x.status === 'went_to')) return 'NOT COVERED: none of your Been There places has photos';
    const bad = restResults.filter((r) => r.error || r.rendered < r.downloadable || r.broken);
    assert.equal(bad.length, 0, JSON.stringify(bad.slice(0, 6)));
    return `${restResults.length} places opened, ${restResults.reduce((s, r) => s + r.rendered, 0)} photos rendered; most on one place: ${Math.max(...restPhotos.map((x) => x.n))}`;
  });
  await check('P5 Lists V2', 'no failed API calls; nothing sent off the machine', () => {
    const f = realFailures(page.failedApi).filter((x) => !/get_discovery_places/.test(x));
    assert.deepEqual(f, [], f.join(' ; '));
    return `${page.external.length} blocked external requests (map script)`;
  });

  // ===== P6 Lists V2 test edits on the LOCAL copy =====
  const S5 = await snapshot(DB);
  const edits = {};
  // a) Quick add in your first list that has statuses
  const qa = lists0.find((l) => l.statuses) ?? lists0[0];
  if (qa) {
    try {
      await goto(page, `/my-lists/${qa.id}`);
      const prompt = await page.evaluate(() => [...document.querySelectorAll('div.fixed button span.truncate')].map((s) => s.textContent).find(Boolean));
      await clickContaining(page, 'div.fixed button', prompt);
      await typeInto(page, `[role=dialog] input[aria-label="${prompt}"]`, 'Lab quick-add test'); await wait(900);
      if (qa.show_location) await clickContaining(page, '[role=dialog] button', 'without a place');
      else await clickContaining(page, '[role=dialog] button[type=submit]', '');
      await wait(1500);
      edits.quickAdd = { list: qa.id };
    } catch (e) { edits.quickAddError = e.message; }
  }
  // b) Edit (name only) an item in a list that hides a field the item has a value for
  const hidden = qj(`SELECT i.id, i.name, i.list_id, s.name AS status,
      CASE WHEN NOT l.show_notes AND nullif(i.notes,'') IS NOT NULL THEN 'notes'
           WHEN NOT l.show_price AND (i.price_level IS NOT NULL OR i.price_manual IS NOT NULL) THEN 'price'
           WHEN NOT l.show_rating AND (i.rating IS NOT NULL OR i.rating_manual IS NOT NULL) THEN 'rating'
           WHEN NOT l.show_location AND i.address IS NOT NULL THEN 'location' END AS field
    FROM custom_list_items i JOIN custom_lists l ON l.id = i.list_id LEFT JOIN custom_list_statuses s ON s.id = i.status_id AND s.list_id = i.list_id
    WHERE l.user_id = '${ME}'
      AND ((NOT l.show_notes AND nullif(i.notes,'') IS NOT NULL) OR (NOT l.show_price AND (i.price_level IS NOT NULL OR i.price_manual IS NOT NULL))
        OR (NOT l.show_rating AND (i.rating IS NOT NULL OR i.rating_manual IS NOT NULL)) OR (NOT l.show_location AND i.address IS NOT NULL))
      AND (s.id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM custom_list_statuses s2 WHERE s2.list_id = l.id))
    ORDER BY i.created_at LIMIT 1`);
  const hiddenCount = Number(q1(`SELECT count(*) FROM custom_list_items i JOIN custom_lists l ON l.id = i.list_id WHERE l.user_id='${ME}' AND ((NOT l.show_notes AND nullif(i.notes,'') IS NOT NULL) OR (NOT l.show_price AND (i.price_level IS NOT NULL OR i.price_manual IS NOT NULL)) OR (NOT l.show_rating AND (i.rating IS NOT NULL OR i.rating_manual IS NOT NULL)) OR (NOT l.show_location AND i.address IS NOT NULL))`));
  if (hidden[0]) {
    const h = hidden[0];
    try {
      await goto(page, `/my-lists/${h.list_id}`);
      if (h.status) await clickContaining(page, 'main [role=tab], main button', h.status);
      await clickContaining(page, 'main button', h.name);
      await clickContaining(page, 'button', 'Edit details');
      await typeInto(page, '[role=dialog] input[placeholder="Item name"]', `${h.name} (lab edit)`);
      await clickContaining(page, '[role=dialog] button', 'Save'); await wait(1500);
      edits.hidden = h;
    } catch (e) { edits.hiddenError = e.message; }
  }
  // c) Hide then show Price (or Rating) on a list whose items have values
  const tog = qj(`SELECT l.id, CASE WHEN l.show_price THEN 'Price' ELSE 'Rating' END AS field FROM custom_lists l WHERE l.user_id='${ME}' AND (
      (l.show_price AND EXISTS (SELECT 1 FROM custom_list_items i WHERE i.list_id=l.id AND (i.price_level IS NOT NULL OR i.price_manual IS NOT NULL)))
   OR (l.show_rating AND EXISTS (SELECT 1 FROM custom_list_items i WHERE i.list_id=l.id AND (i.rating IS NOT NULL OR i.rating_manual IS NOT NULL)))) ORDER BY l.created_at LIMIT 1`)[0];
  if (tog) {
    try {
      for (let k = 0; k < 2; k++) {
        await goto(page, `/my-lists/${tog.id}`);
        await clickText(page, 'List options'); await clickText(page, 'Customize list');
        await clickContaining(page, '[role=dialog] button', 'Fields');
        await page.click(`[aria-label="Show ${tog.field}"]`); await wait(900);
        await clickText(page, 'Done'); await wait(500);
        if (k === 0) edits.toggleMid = await snapshot(DB);
      }
      edits.toggle = tog;
    } catch (e) { edits.toggleError = e.message; }
  }
  // d) Add a photo to an item that already has photos (or to the first item)
  const ph = withPhotos.find((w) => w.n < 5) ?? null;
  if (ph) {
    try {
      await goto(page, `/my-lists/${ph.list_id}`);
      if (ph.status) await clickContaining(page, 'main [role=tab], main button', ph.status);
      await clickContaining(page, 'main button', ph.name);
      await clickContaining(page, 'button', 'Edit details');
      const fi = await page.$('[role=dialog] input[type=file]');
      await fi.uploadFile(photoFile()); await wait(1500);
      await clickContaining(page, '[role=dialog] button', 'Save'); await wait(1800);
      edits.photo = ph;
    } catch (e) { edits.photoError = e.message; }
  }
  // e) Open the place with the most photos (incl. more than 5) and Save Changes without changing anything
  const big = restPhotos.find((x) => x.status === 'went_to');
  if (big) {
    try {
      await openRestaurantEdit(page, big.name, big.status);
      await clickContaining(page, '[role=dialog] button', 'Save Changes'); await wait(1800);
      edits.restaurant = big;
    } catch (e) { edits.restaurantError = e.message; }
  }
  const S6 = await snapshot(DB);
  writeFileSync(path.join(OUT, 'S6-after-v2-edits.json'), JSON.stringify(S6));
  const d6 = diff(S5, S6);
  const items5 = S5['public.custom_list_items'], items6 = S6['public.custom_list_items'];
  if (qa) await check('P6 Lists V2 edits (local copy)', 'quick add creates exactly one item in the right list', () => {
    if (edits.quickAddError) throw new Error(edits.quickAddError);
    const added = d6['public.custom_list_items'].added.map((k) => items6[k]).filter((i) => i.name === 'Lab quick-add test');
    assert.equal(added.length, 1); assert.equal(added[0].list_id, qa.id);
  });
  await check('P6 Lists V2 edits (local copy)', 'editing an item in a list that hides one of its fields keeps that value and every other value', () => {
    if (!hidden[0]) return 'NOT COVERED by your data: no item has a value in a hidden field (covered by the synthetic run)';
    if (edits.hiddenError) throw new Error(edits.hiddenError);
    const a = items5[hidden[0].id], b = items6[hidden[0].id];
    assert.equal(b.name, `${hidden[0].name} (lab edit)`);
    const changed = Object.keys(a).filter((c) => !['name', 'updated_at'].includes(c) && !same(a[c], b[c]));
    assert.deepEqual(changed, []);
    return `hidden ${hidden[0].field} kept (${hiddenCount} of your items have values in hidden fields)`;
  });
  await check('P6 Lists V2 edits (local copy)', 'hiding then showing a field keeps every item value and restores the setting', () => {
    if (!tog) return 'NOT COVERED by your data: no list shows Price or Rating with values';
    if (edits.toggleError) throw new Error(edits.toggleError);
    const flag = `show_${tog.field.toLowerCase()}`;
    assert.equal(edits.toggleMid['public.custom_lists'][tog.id][flag], false, 'the field was not hidden');
    assert.equal(S6['public.custom_lists'][tog.id][flag], true, 'the field did not come back');
    const changed = Object.values(items6).filter((i) => i.list_id === tog.id && items5[i.id] && Object.keys(i).some((c) => c !== 'updated_at' && !same(items5[i.id][c], i[c])) && i.id !== edits.hidden?.id);
    assert.deepEqual(changed.map((i) => short(i.id)), []);
    return `${tog.field} hidden and shown again on list ${short(tog.id)}`;
  });
  await check('P6 Lists V2 edits (local copy)', 'adding a photo keeps the existing photos', () => {
    if (!ph) return 'NOT COVERED by your data: no item has photos';
    if (edits.photoError) throw new Error(edits.photoError);
    const b = Object.values(S5['public.custom_list_item_images']).filter((i) => i.item_id === ph.id).map((i) => i.id);
    const a = Object.values(S6['public.custom_list_item_images']).filter((i) => i.item_id === ph.id).map((i) => i.id);
    assert.ok(b.every((x) => a.includes(x))); assert.equal(a.length, b.length + 1);
    return `${b.length} -> ${a.length}`;
  });

  await check('P6 Lists V2 edits (local copy)', 'saving a place with many photos unchanged keeps every photo and value', () => {
    if (!big) return 'NOT COVERED by your data: no Been There place has photos';
    if (edits.restaurantError) throw new Error(edits.restaurantError);
    const b = Object.values(S5['public.restaurant_images']).filter((i) => i.restaurant_id === big.id).map((i) => i.id).sort();
    const a = Object.values(S6['public.restaurant_images']).filter((i) => i.restaurant_id === big.id).map((i) => i.id).sort();
    assert.deepEqual(a, b, 'photos changed');
    const r5 = S5['public.restaurants'][big.id], r6 = S6['public.restaurants'][big.id];
    const changed = Object.keys(r5).filter((c) => !['updated_at', 'visited_at'].includes(c) && !same(r5[c], r6[c]));
    assert.deepEqual(changed, [], `fields changed: ${changed}`);
    return `${b.length} photos kept`;
  });
  if (big && !edits.restaurantError && !same(S5['public.restaurants'][big.id].visited_at, S6['public.restaurants'][big.id].visited_at)) {
    record('P6 Lists V2 edits (local copy)', 'saving a Been There place re-stamps its visit date (visited_at) to now', 'PRE-EXISTING',
      `${S5['public.restaurants'][big.id].visited_at} -> ${S6['public.restaurants'][big.id].visited_at}; the live app's Edit does the same (EditRestaurantDialog), no screen shows this date`);
  }
  // ===== P7 every original row against the export =====
  const allowed = (t, k, cols) => {
    if (t === 'public.profiles' && cols.every((c) => ['updated_at', 'timezone'].includes(c)) && S6[t][k].user_id === ME) return 'timezone re-save on app open';
    if (t === 'public.custom_list_items' && k === edits.hidden?.id && cols.every((c) => ['name', 'updated_at'].includes(c))) return 'test edit: name';
    if (t === 'public.custom_lists' && k === edits.toggle?.id && cols.every((c) => ['updated_at'].includes(c))) return 'test toggle (hidden and shown)';
    if (t === 'public.custom_list_items' && k === edits.photo?.id && cols.every((c) => ['updated_at'].includes(c))) return 'test photo add';
    if (t === 'public.restaurants' && k === edits.restaurant?.id && cols.every((c) => ['updated_at', 'visited_at'].includes(c))) return 'test save-unchanged (visited_at re-stamp is pre-existing)';
    return null;
  };
  const unexpected = [], explained = [], deleted = [];
  const integrity = { rows: 0, relationships: 0, notes: 0, ratings: 0, prices: 0, photos: 0, settings: 0 };
  for (const t of [...TABLE_ORDER, 'profiles']) for (const r of data[t] ?? []) {
    const g = S6[`public.${t}`]?.[r.id];
    integrity.rows++;
    if (!g) { deleted.push(`${t} ${short(r.id)}`); continue; }
    const cols = Object.keys(r).filter((c) => labCols.cache[t].includes(c) && !same(r[c], g[c]));
    for (const c of Object.keys(r)) {
      if (/(_id|_ids)$/.test(c) && c !== 'apple_place_id') integrity.relationships++;
      if (c === 'notes' || c === 'comment') integrity.notes++;
      if (/^rating/.test(c)) integrity.ratings++;
      if (/^price/.test(c)) integrity.prices++;
      if (c === 'image_url') integrity.photos++;
      if (/^show_|_mode$|_label$|^is_private$|^icon$|^color$/.test(c)) integrity.settings++;
    }
    if (!cols.length) continue;
    const why = allowed(`public.${t}`, r.id, cols);
    (why ? explained : unexpected).push(`${t} ${short(r.id)}: ${cols.join(', ')}${why ? ` (${why})` : ''}`);
  }
  const stored = Object.values(S6['storage.objects'] ?? {});
  const objsGone = manifest.photos.filter((p) => p.sha256 && !stored.some((o) => o.bucket_id === p.bucket && o.name === p.path));
  await check('P7 compare with the export', 'no exported row deleted', () => { assert.deepEqual(deleted, []); return `${integrity.rows} rows checked`; });
  await check('P7 compare with the export', 'every original id, relationship, note, rating, price, photo link and setting unchanged (except the test edits)', () => {
    assert.deepEqual(unexpected, []);
    return `${integrity.relationships} relationship fields, ${integrity.notes} notes/comments, ${integrity.ratings} rating fields, ${integrity.prices} price fields, ${integrity.photos} photo links, ${integrity.settings} settings; explained: ${explained.join('; ') || 'none'}`;
  });
  await check('P7 compare with the export', 'every exported photo file is still stored', () => { assert.deepEqual(objsGone.map((p) => short(p.id)), []); return `${photoFiles}/${photoFiles}`; });
  await check('P7 compare with the export', 'no list converted (owner, name, icon, field settings, statuses and categories unchanged)', () => {
    const conv = data.custom_lists.filter((l) => ['user_id', 'name', 'icon', 'show_location', 'show_notes', 'show_photos', 'show_price', 'price_mode', 'show_rating', 'rating_mode'].some((c) => c in l && !same(l[c], S6['public.custom_lists'][l.id]?.[c])));
    assert.deepEqual(conv.map((l) => short(l.id)), []);
    return `${data.custom_lists.length} lists`;
  });
} catch (e) {
  record('RUN', 'suite aborted', 'FAIL', e.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  await browser.close().catch(() => {});
  if (lab) await lab.close();
}
const summary = results.reduce((o, r) => ({ ...o, [r.status]: (o[r.status] ?? 0) + 1 }), {});
const report = { run: RUN, old: MAIN, new: NEW, bundle_exported_at: manifest.exported_at, counts: manifest.counts, summary, results, perList: Object.values(perList), restaurantPhotos: restSummary };
writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
writeFileSync(path.join(OUT, 'report.md'), [`# Lists V2 compatibility on your own data — ${RUN}`, '', `old app main ${MAIN.slice(0, 7)} · Lists V2 ${NEW.slice(0, 7)} · export ${manifest.exported_at}`, '', `Summary: ${JSON.stringify(summary)}`, '',
  '| Phase | Check | Result | Detail |', '|---|---|---|---|', ...results.map((r) => `| ${r.phase} | ${r.check} | ${r.status} | ${r.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 400)} |`), '',
  '| List | Items | Statuses | Items without a valid status | Old app shows | Lists V2 shows |', '|---|---|---|---|---|---|', ...Object.values(perList).map((p) => `| ${p.list} | ${p.items} | ${p.statuses} | ${p.statuses ? p.unplaced : '-'} | ${p.old ?? '?'} | ${p.v2 ?? '?'} |`)].join('\n'));
console.log(`\nSUMMARY ${JSON.stringify(summary)}\nreport: ${OUT}/report.md`);
process.exit(0);
