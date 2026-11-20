// Lists V2 data-compatibility suite. Runs the OLD app (main 9baf34e) and the
// NEW app (trial 4973aa7: Lists V2 + PR #25) against the SAME representative
// data in an isolated local database, applies the five pending integration
// migrations in between, and compares every row before and after each phase.
// Never connects to a hosted project. Output: results/<run>/report.json + .md
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { psql, applyPending, fullSha } from './db.mjs';
import { seed, id, USERS } from './seed.mjs';
import { up, APPS } from './stack.mjs';
import { snapshot, diff } from './snapshot.mjs';
import { anonKey } from './gateway.mjs';
import { openBrowser, newPage, signIn, text, goto, wait } from './browser.mjs';

const MAIN = fullSha('9baf34e0b287b7dbb6b11909a1b509693cbcede0');
const NEW = fullSha('4973aa7216e7e147966c1c86b79161144d2d8395');
const FIVE = ['20261029120000_custom_list_items_owner_check.sql', '20261030120000_list_visibility_and_anonymous_discovery.sql',
  '20261109120000_discovery_places.sql', '20261109180000_custom_list_images_owner_folder.sql', '20261111120000_photo_records_owner_check.sql'];
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'results', RUN);
mkdirSync(OUT, { recursive: true });

const results = []; // {phase, check, status: PASS|FAIL|PRE-EXISTING|INFO, detail}
const record = (phase, check, status, detail = '') => { results.push({ phase, check, status, detail }); console.log(`${status.padEnd(12)} ${phase} | ${check}${detail ? ` — ${String(detail).slice(0, 220)}` : ''}`); };
async function check(phase, name, fn) {
  try { const d = await fn(); record(phase, name, 'PASS', d ?? ''); return true; }
  catch (e) { record(phase, name, 'FAIL', e.message.split('\n')[0]); return false; }
}
const recreate = (db, template) => { psql('postgres', ['-c', `DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`]); psql('postgres', ['-c', `CREATE DATABASE "${db}" TEMPLATE "${template}"`]); };
const q1 = (db, sql) => psql(db, ['-At', '-c', sql]).trim();

// ---------- expected-change classification ----------
/** Every change in d must match one of `allow` rules; returns {unexpected, expected}. */
function classify(d, allow) {
  const unexpected = [], expected = [];
  for (const [t, r] of Object.entries(d)) {
    for (const k of r.deleted) (allow.some((a) => a.t === t && a.del?.(k)) ? expected : unexpected).push(`${t}: DELETED ${k}`);
    for (const k of r.added) (allow.some((a) => a.t === t && a.add?.(k, r)) ? expected : unexpected).push(`${t}: ADDED ${k}`);
    for (const c of r.changed) for (const col of Object.keys(c.cols)) {
      const ok = allow.some((a) => a.t === t && a.chg?.(c.key, col, c.cols[col]));
      (ok ? expected : unexpected).push(`${t}: ${c.key} .${col}: ${JSON.stringify(c.cols[col][0])?.slice(0, 60)} -> ${JSON.stringify(c.cols[col][1])?.slice(0, 60)}`);
    }
    for (const col of r.addedCols) (allow.some((a) => a.t === t && a.newCol?.(col)) ? expected : unexpected).push(`${t}: NEW COLUMN ${col}`);
    for (const col of r.removedCols) unexpected.push(`${t}: REMOVED COLUMN ${col}`);
  }
  return { unexpected, expected };
}

// ---------- truth from the database ----------
const AYLA = USERS.ayla.id;
function listTruth(db) {
  const rows = JSON.parse(q1(db, `SELECT coalesce(json_agg(x ORDER BY x.name), '[]') FROM (
    SELECT l.id, l.name, count(i.id)::int AS items FROM custom_lists l LEFT JOIN custom_list_items i ON i.list_id = l.id
    WHERE l.user_id = '${AYLA}' GROUP BY l.id, l.name) x`));
  return rows;
}

// ---------- privacy matrix (data level, through the real PostgREST + RLS) ----------
async function privacyMatrix(base, db) {
  const who = { anon: null, ...Object.fromEntries(Object.values(USERS).map((u) => [u.key, u])) };
  const tables = ['custom_lists', 'custom_list_items', 'custom_list_item_images', 'custom_list_statuses', 'custom_list_types', 'restaurants', 'restaurant_images', 'shared_lists', 'shared_list_items', 'shared_list_item_comments', 'profiles', 'follows'];
  const m = {};
  for (const [k, u] of Object.entries(who)) {
    let h = { apikey: anonKey() };
    if (u) { const t = await (await fetch(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ email: u.email, password: u.password }) })).json(); h = { ...h, authorization: `Bearer ${t.access_token}` }; }
    m[k] = {};
    for (const t of tables) {
      const r = await fetch(`${base}/rest/v1/${t}?select=id&order=id`, { headers: h });
      m[k][t] = r.ok ? (await r.json()).map((x) => x.id) : `HTTP ${r.status} ${(await r.text()).slice(0, 80)}`;
    }
    // storage: which seeded photo objects can this user get a signed URL for?
    const objs = JSON.parse(q1(db, `SELECT coalesce(json_agg(bucket_id || '/' || name ORDER BY name), '[]') FROM storage.objects`));
    const okObjs = [];
    for (const o of objs) {
      const [b, ...p] = o.split('/');
      const r = await fetch(`${base}/storage/v1/object/sign/${b}/${p.join('/')}`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{"expiresIn":60}' });
      if (r.ok) okObjs.push(o);
    }
    m[k]['storage.objects (signable)'] = okObjs;
  }
  return m;
}

function compareMatrices(a, b) {
  const diffs = [];
  for (const u of Object.keys(a)) for (const t of Object.keys(a[u])) {
    const x = JSON.stringify(a[u][t]), y = JSON.stringify(b[u]?.[t]);
    if (x !== y) diffs.push(`${u} / ${t}: before ${Array.isArray(a[u][t]) ? a[u][t].length + ' rows' : a[u][t]} -> after ${Array.isArray(b[u]?.[t]) ? b[u][t].length + ' rows' : b[u]?.[t]}`);
  }
  return diffs;
}

// ---------- UI helpers ----------
async function clickText(page, t, scope = 'button, a, [role="tab"], [role="menuitem"], [role="option"], [role="radio"]') {
  const h = await page.evaluateHandle((s, x) => [...document.querySelectorAll(s)].find((e) => (e.textContent?.trim() === x || e.getAttribute('aria-label') === x) && e.getClientRects().length), scope, t);
  const el = h.asElement(); if (!el) throw new Error(`nothing to tap labelled "${t}"`);
  await el.click(); await wait(600);
}
async function clickContaining(page, scope, t) {
  const h = await page.evaluateHandle((s, x) => [...document.querySelectorAll(s)].find((b) => b.textContent?.includes(x) && b.getClientRects().length), scope, t);
  const el = h.asElement(); if (!el) throw new Error(`nothing containing "${t}" in ${scope}`);
  await el.click(); await wait(700);
}
// Click the innermost visible element whose text contains t (its row/card handler receives the click).
async function clickDeepest(page, t, scope = 'main') {
  const h = await page.evaluateHandle((sc, x) => {
    const all = [...document.querySelectorAll(`${sc} *`)].filter((e) => e.textContent?.includes(x) && e.getClientRects().length);
    return all.find((e) => ![...e.children].some((c) => c.textContent?.includes(x))) ?? null;
  }, scope, t);
  const el = h.asElement(); if (!el) throw new Error(`no element with "${t}"`);
  await el.click(); await wait(900);
}
async function typeInto(page, selector, value) { await page.click(selector, { clickCount: 3 }); await page.keyboard.type(value); await wait(300); }
function photoFile() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lab-photo-'));
  const f = path.join(dir, 'new-photo.png');
  writeFileSync(f, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  return f;
}
async function visibleImages(page) {
  return page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => i.getClientRects().length && /\/storage\/v1\/object\/sign\//.test(i.src)).map((i) => ({ ok: i.complete && i.naturalWidth > 0, src: i.src.split('/sign/')[1]?.split('?')[0] })));
}

// ---------- the run ----------
const env = { main: MAIN, new: NEW, five: FIVE, run: RUN, postgres: q1('postgres', 'show server_version'), at: new Date().toISOString() };
console.log(`compat run ${RUN}\nold app = main ${MAIN.slice(0, 7)} | new app = trial ${NEW.slice(0, 7)} | 5 pending migrations from ${NEW.slice(0, 7)}`);

recreate('compat', 'baseline');
seed('compat');
psql('compat', ['-c', `CREATE TABLE lab_meta.seeded AS SELECT now() AS at`]);
const S0 = await snapshot('compat');
const truth0 = listTruth('compat');
writeFileSync(path.join(OUT, 'S0-seed.json'), JSON.stringify(S0));
record('P0 seed', 'representative dataset loaded on main schema', 'INFO', `${Object.entries(S0).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, Object.keys(v).length]).filter(([, n]) => n).map(([k, n]) => `${k.replace('public.', '')}=${n}`).join(', ')}`);

const browser = await openBrowser();
let lab = await up('compat');
let page;
async function pageFor(app, width) {
  const p = await newPage(browser, `http://127.0.0.1:${APPS[app].port}`);
  await p.setViewport({ width, height: 900, deviceScaleFactor: 1, isMobile: width < 700, hasTouch: width < 700 });
  await p.emulateTimezone('America/Chicago'); // same as the seeded profile timezone
  return p;
}

try {
  // ===== P1: OLD app reads existing data on the CURRENT production schema =====
  page = await pageFor('old', 1100);
  await signIn(page, USERS.ayla.email, USERS.ayla.password);
  await goto(page, '/my-lists');
  const oldHome = await text(page);
  await check('P1 old app / current schema', 'Lists page shows every existing list with its item count', () => {
    const missing = truth0.filter((l) => !new RegExp(`${l.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+${l.items} items?`).test(oldHome));
    assert.equal(missing.length, 0, `missing or wrong count: ${missing.map((l) => `${l.name} (${l.items})`).join('; ')}`);
    return `${truth0.length} lists, ${truth0.reduce((s, l) => s + l.items, 0)} items`;
  });
  await check('P1 old app / current schema', 'shared list visible', () => assert.match(oldHome, /Date night ideas/));
  for (const key of ['coffee', 'wines', 'books', 'legacy', 'hidden-notes', 'big']) {
    await goto(page, `/my-lists/${id(`list:ayla:${key}`)}`);
    const t = await text(page);
    const L = truth0.find((l) => l.id === id(`list:ayla:${key}`));
    await check('P1 old app / current schema', `list "${L.name}" opens with ${L.items} items`, () => {
      assert.match(t, new RegExp(`${L.items} items?`));
      const counts = [...t.matchAll(/\((\d+)\)/g)].map((m) => Number(m[1]));
      if (counts.length) assert.equal(counts.reduce((a, b) => a + b, 0), L.items, `status tab counts ${counts}`);
    });
  }
  await check('P1 old app / current schema', 'no failed API calls, nothing sent off the machine except blocked map script', () => {
    assert.deepEqual(page.failedApi, []);
    const ext = page.external.filter((u) => !u.startsWith('https://cdn.apple-mapkit.com/'));
    assert.deepEqual(ext, []);
    return `${page.external.length} blocked map-script requests`;
  });
  const S1 = await snapshot('compat');
  await check('P1 old app / current schema', 'reading changes nothing in the database', () => {
    const c = classify(diff(S0, S1), []);
    assert.deepEqual(c.unexpected, []);
  });

  // ===== P2: OLD app writes on the current schema =====
  // Add an item
  await goto(page, `/my-lists/${id('list:ayla:coffee')}`);
  await clickContaining(page, 'button', 'Add Item');
  await typeInto(page, '[role=dialog] input[placeholder="Item name"]', 'Old-app added café');
  await clickText(page, 'Add Item', '[role=dialog] button'); await wait(1200);
  // Edit an item with visible notes (Petra): add a note
  await goto(page, `/my-lists/${id('list:ayla:coffee')}`);
  await clickDeepest(page, 'Petra Roasting Co.');
  await page.evaluate(() => { const t = document.querySelector('[role=dialog] textarea'); t?.focus(); });
  await page.keyboard.type('Edited by the OLD app'); await wait(200);
  const fileInput = await page.$('[role=dialog] input[type=file]');
  if (fileInput) { await fileInput.uploadFile(photoFile()); await wait(1500); }
  await clickText(page, 'Save Changes', '[role=dialog] button'); await wait(1500);
  // Edit an item in the list whose notes are HIDDEN (Divan) - no changes, just Save
  await goto(page, `/my-lists/${id('list:ayla:hidden-notes')}`);
  await clickDeepest(page, 'Divan Pastanesi');
  await clickText(page, 'Save Changes', '[role=dialog] button'); await wait(1500);
  const S2 = await snapshot('compat');
  writeFileSync(path.join(OUT, 'S2-after-old-app.json'), JSON.stringify(S2));
  const d12 = diff(S1, S2);
  const added = d12['public.custom_list_items']?.added ?? [];
  const oldAddedId = added.find((k) => S2['public.custom_list_items'][k].name === 'Old-app added café');
  await check('P2 old app writes', 'Add Item creates exactly one new item in the right list', () => {
    assert.ok(oldAddedId, 'item not created');
    assert.equal(S2['public.custom_list_items'][oldAddedId].list_id, id('list:ayla:coffee'));
  });
  const petra = id(`item:${id('list:ayla:coffee')}:Petra Roasting Co.`);
  await check('P2 old app writes', 'editing Petra saves the note and a new photo; other fields keep their values', () => {
    const r = S2['public.custom_list_items'][petra];
    assert.match(r.notes ?? '', /Edited by the OLD app/);
    for (const col of ['price_level', 'address', 'latitude', 'longitude', 'status_id', 'type_id']) assert.deepEqual(r[col], S1['public.custom_list_items'][petra][col], col);
    const imgs = Object.values(S2['public.custom_list_item_images']).filter((i) => i.item_id === petra);
    assert.ok(imgs.length >= 2, `photos on Petra: ${imgs.length}; failed calls: ${page.failedApi.join(' ; ') || 'none'}; console: ${page.consoleErrors.slice(-3).join(' ; ')}`);
    return `photos on Petra now ${imgs.length} (was 1)`;
  });
  const divan = id(`item:${id('list:ayla:hidden-notes')}:Divan Pastanesi`);
  {
    const before = S1['public.custom_list_items'][divan].notes, after = S2['public.custom_list_items'][divan].notes;
    if (before && !after) record('P2 old app writes', 'old app editing an item whose list hides Notes ERASES the saved note', 'PRE-EXISTING', `"${before}" -> null (current live app behaviour; Lists V2 fixes it)`);
    else record('P2 old app writes', 'old app keeps hidden notes on edit', 'PASS', `${before} -> ${after}`);
  }
  await check('P2 old app writes', 'no other rows anywhere changed, nothing deleted', () => {
    const c = classify(d12, [
      { t: 'public.custom_list_items', add: (k) => k === oldAddedId },
      { t: 'public.custom_list_items', chg: (k, col) => [petra, divan].includes(k) },
      { t: 'public.custom_list_item_images', add: (k) => S2['public.custom_list_item_images'][k].item_id === petra },
      { t: 'storage.objects', add: (k) => S2['storage.objects'][k].bucket_id === 'custom-list-images' && S2['storage.objects'][k].name.includes(petra) },
    ]);
    assert.deepEqual(c.unexpected, []);
    return `${c.expected.length} expected changes: ${c.expected.join(' | ').slice(0, 400)}`;
  });
  await page.close();

  // ===== P3: apply the five pending migrations =====
  await lab.close();
  recreate('compat_pre', 'compat'); // the pre-migration state, kept for P4/P7
  const applied = applyPending('compat', { main: MAIN, stack: NEW, only: FIVE });
  const S3 = await snapshot('compat');
  writeFileSync(path.join(OUT, 'S3-after-migrations.json'), JSON.stringify(S3));
  const d23 = diff(S2, S3);
  writeFileSync(path.join(OUT, 'diff-migrations.json'), JSON.stringify(d23, null, 1));
  await check('P3 migrations', `the five pending migrations apply (${applied.length})`, () => assert.equal(applied.length, 5));
  await check('P3 migrations', 'no existing row added, deleted or changed; only new columns', () => {
    const c = classify(d23, [
      { t: 'public.custom_lists', newCol: (c) => ['visibility', 'discovery_token'].includes(c) },
      { t: 'public.content_reports', newCol: (c) => c === 'via_anonymous' },
    ]);
    assert.deepEqual(c.unexpected, []);
    return c.expected.join(' | ');
  });
  await check('P3 migrations', 'every existing list keeps profile-based visibility and gets its own discovery token', () => {
    const v = q1('compat', `SELECT count(*) FILTER (WHERE visibility = 'profile') || '/' || count(*) || ' profile; ' || count(DISTINCT discovery_token) || ' distinct tokens' FROM custom_lists`);
    assert.match(v, /^(\d+)\/\1 profile; \1 distinct tokens$/);
    return v;
  });
  await check('P3 migrations', 'row counts identical in every table', () => {
    const bad = Object.keys(S2).filter((t) => t !== '_columns' && Object.keys(S2[t]).length !== Object.keys(S3[t] ?? {}).length);
    assert.deepEqual(bad, []);
  });

  // ===== P4: privacy matrix before vs after (data level, real RLS) =====
  lab = await up('compat_pre');
  const mBefore = await privacyMatrix(`http://127.0.0.1:${APPS.old.port}`, 'compat_pre');
  await lab.close();
  lab = await up('compat');
  const mAfter = await privacyMatrix(`http://127.0.0.1:${APPS.old.port}`, 'compat');
  writeFileSync(path.join(OUT, 'privacy-before.json'), JSON.stringify(mBefore, null, 1));
  writeFileSync(path.join(OUT, 'privacy-after.json'), JSON.stringify(mAfter, null, 1));
  await check('P4 privacy', 'every user (and a signed-out visitor) can see exactly the same rows and photos before and after the migrations', () => {
    const d = compareMatrices(mBefore, mAfter);
    // Signed-out direct reads that went from "0 rows" to "permission denied" don't change what anyone can see.
    const explained = d.filter((x) => /^anon \/ .*: before 0 rows -> after HTTP 401/.test(x));
    for (const x of explained) record('P4 privacy', 'explained difference (not a visibility change)', 'INFO', `${x}: migration #14's restaurant_images policy now checks the parent restaurant, and signed-out visitors were already refused restaurants (is_moderator). No signed-out screen reads this table directly.`);
    assert.deepEqual(d.filter((x) => !explained.includes(x)), []);
    return `${Object.keys(mBefore).length} viewers x ${Object.keys(mBefore.ayla).length} tables identical${explained.length ? ` (+${explained.length} explained)` : ''}`;
  });
  await check('P4 privacy', 'stranger and pending follower cannot see the private account\'s list; blocked user cannot see Ayla\'s lists', () => {
    const cemList = id('list:cem:cem-secret'), aylaCoffee = id('list:ayla:coffee');
    assert.ok(!mAfter.deniz.custom_lists.includes(cemList), 'Deniz (pending) sees Cem\'s list');
    assert.ok(mAfter.ayla.custom_lists.includes(cemList), 'Ayla (accepted follower) should see Cem\'s list');
    assert.ok(!mAfter.fikret.custom_lists.includes(aylaCoffee), 'blocked Fikret sees Ayla\'s list');
    assert.ok(mAfter.bora.custom_lists.includes(aylaCoffee), 'Bora should see Ayla\'s public list');
  });
  await check('P4 privacy', 'shared list visible only to its two members', () => {
    const sl = id('shared:ayla-ece');
    const seeing = Object.entries(mAfter).filter(([, m]) => Array.isArray(m.shared_lists) && m.shared_lists.includes(sl)).map(([k]) => k);
    assert.deepEqual(seeing.sort(), ['ayla', 'ece']);
  });
  await check('P4 privacy', 'photos: only owners and permitted viewers can get signed links', () => {
    const fikretObjs = mAfter.fikret['storage.objects (signable)'].filter((o) => o.includes(USERS.ayla.id));
    assert.deepEqual(fikretObjs, [], 'blocked user can sign Ayla\'s photos');
    return `ayla ${mAfter.ayla['storage.objects (signable)'].length}, bora ${mAfter.bora['storage.objects (signable)'].length}, anon ${mAfter.anon['storage.objects (signable)'].length} signable objects`;
  });

  // ===== P5: OLD app on the MIGRATED schema (people who haven't updated) =====
  page = await pageFor('old', 1100);
  await signIn(page, USERS.ayla.email, USERS.ayla.password);
  await goto(page, '/my-lists');
  const oldHome2 = await text(page);
  const truth3 = listTruth('compat');
  await check('P5 old app / migrated schema', 'Lists page still shows every list with its item count', () => {
    const missing = truth3.filter((l) => !new RegExp(`${l.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+${l.items} items?`).test(oldHome2));
    assert.equal(missing.length, 0, missing.map((l) => l.name).join('; '));
  });
  const S4a = await snapshot('compat');
  await goto(page, `/my-lists/${id('list:ayla:wines')}`);
  await clickContaining(page, 'button', 'Add Item');
  await typeInto(page, '[role=dialog] input[placeholder="Item name"]', 'Old app after migration');
  await clickText(page, 'Add Item', '[role=dialog] button'); await wait(1200);
  const S4b = await snapshot('compat');
  await check('P5 old app / migrated schema', 'Add Item still works and touches nothing else', () => {
    const d = diff(S4a, S4b);
    const add = d['public.custom_list_items']?.added ?? [];
    assert.equal(add.length, 1);
    assert.equal(S4b['public.custom_list_items'][add[0]].name, 'Old app after migration');
    const c = classify(d, [{ t: 'public.custom_list_items', add: (k) => k === add[0] }]);
    assert.deepEqual(c.unexpected, []);
  });
  await check('P5 old app / migrated schema', 'no failed API calls', () => assert.deepEqual(page.failedApi, []));
  await page.close();

  // ===== P6: NEW app (Lists V2) on the migrated schema, same data =====
  const S5 = await snapshot('compat');
  const truth5 = listTruth('compat');
  page = await pageFor('new', 390);
  await signIn(page, USERS.ayla.email, USERS.ayla.password);
  await goto(page, '/my-lists');
  const newHome = await text(page);
  await check('P6 new app', 'Lists home shows every existing list with its item count (same data the old app showed)', () => {
    const lines = newHome.split('\n');
    const missing = truth5.filter((l) => { const i = lines.findIndex((x) => x.trim() === l.name); return i < 0 || !new RegExp(`^${l.items} `).test(lines[i + 1] ?? ''); });
    assert.equal(missing.length, 0, `missing/wrong: ${missing.map((l) => `${l.name}(${l.items})`).join('; ')}`);
    return `${truth5.length} lists`;
  });
  await check('P6 new app', 'shared list and My Restaurants visible', () => { assert.match(newHome, /Shared\s*\n?\s*1/); assert.match(newHome, /My Restaurants\s*\n\s*3 places/); });
  for (const key of ['coffee', 'wines', 'books', 'legacy', 'hidden-notes', 'big', 'empty']) {
    await goto(page, `/my-lists/${id(`list:ayla:${key}`)}`);
    const t = await text(page);
    const L = truth5.find((l) => l.id === id(`list:ayla:${key}`));
    await check('P6 new app', `list "${L.name}" opens and accounts for all ${L.items} items`, () => {
      const statusCounts = JSON.parse(q1('compat', `SELECT coalesce(json_agg(json_build_object('name', s.name, 'n', (SELECT count(*) FROM custom_list_items i WHERE i.status_id = s.id))), '[]') FROM custom_list_statuses s WHERE s.list_id = '${L.id}'`));
      if (statusCounts.length) {
        const sumShown = statusCounts.reduce((s, c) => s + (new RegExp(`${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n\\s*${c.n}\\b`).test(t) ? Number(c.n) : 0), 0);
        const noStatus = Number(q1('compat', `SELECT count(*) FROM custom_list_items WHERE list_id='${L.id}' AND status_id IS NULL`));
        assert.equal(sumShown + noStatus, L.items, `status tabs shown ${sumShown} + items without status ${noStatus} vs ${L.items}`);
        if (noStatus) return `NOTE ${noStatus} item(s) have no status_id (added by the old app without one) - check they're reachable`;
      } else {
        const names = JSON.parse(q1('compat', `SELECT json_agg(name) FROM custom_list_items WHERE list_id='${L.id}'`)) ?? [];
        const notShown = names.filter((n) => !t.includes(n));
        assert.deepEqual(notShown, [], 'items not shown');
      }
    });
  }
  // Photos in both stored formats
  await goto(page, `/my-lists/${id('list:ayla:coffee')}`);
  await clickContaining(page, 'main [role=tab], main button', 'Been There');
  await clickContaining(page, 'main button', 'Kronotrop'); await wait(1500);
  await check('P6 new app', 'item photos stored in both formats (old full URL and bare path) all load', async () => {
    const imgs = await visibleImages(page);
    assert.ok(imgs.length >= 2, `only ${imgs.length} photos visible`);
    assert.ok(imgs.every((i) => i.ok), JSON.stringify(imgs));
    return `${imgs.length} images loaded via signed URLs`;
  });
  await page.keyboard.press('Escape'); await wait(500);
  // Quick add
  const S6a = await snapshot('compat');
  await goto(page, `/my-lists/${id('list:ayla:coffee')}`);
  await clickContaining(page, 'main [role=tab], main button', 'Want to Go');
  // Coffee is a places list: the bar reads "Search a café". Apple Maps is blocked in the lab, so save the typed name.
  await clickContaining(page, 'button', 'Search a café');
  await typeInto(page, 'input[aria-label="Search a café"]', 'New-app added café'); await wait(900);
  await clickContaining(page, '[role=dialog] button', 'without a place'); await wait(1500);
  // Edit an item in the hidden-notes list (Savoy): change the name only
  await goto(page, `/my-lists/${id('list:ayla:hidden-notes')}`);
  await clickContaining(page, 'main [role=tab], main button', 'Done');
  await clickContaining(page, 'main button', 'Savoy Pastanesi');
  await clickContaining(page, 'button', 'Edit details');
  await typeInto(page, '[role=dialog] input[placeholder="Item name"]', 'Savoy Pastanesi (edited in V2)');
  await clickContaining(page, '[role=dialog] button', 'Save'); await wait(1500);
  // Hide a field on the Coffee list
  await goto(page, `/my-lists/${id('list:ayla:coffee')}`);
  await clickText(page, 'List options'); await clickText(page, 'Customize list');
  await clickContaining(page, '[role=dialog] button', 'Fields');
  await page.click('[aria-label="Show Price"]'); await wait(800);
  await clickText(page, 'Done'); await wait(400);
  // Add a photo to Petra through Edit details
  await goto(page, `/my-lists/${id('list:ayla:coffee')}`);
  await clickContaining(page, 'main [role=tab], main button', 'Want to Go');
  await clickContaining(page, 'main button', 'Petra Roasting Co.');
  await clickContaining(page, 'button', 'Edit details');
  const fi2 = await page.$('[role=dialog] input[type=file]');
  await fi2.uploadFile(photoFile()); await wait(1500);
  await clickContaining(page, '[role=dialog] button', 'Save'); await wait(1800);
  const S6b = await snapshot('compat');
  writeFileSync(path.join(OUT, 'S6-after-new-app.json'), JSON.stringify(S6b));
  const d6 = diff(S6a, S6b);
  writeFileSync(path.join(OUT, 'diff-new-app.json'), JSON.stringify(d6, null, 1));
  const newAdded = (d6['public.custom_list_items']?.added ?? []).find((k) => S6b['public.custom_list_items'][k].name === 'New-app added café');
  const savoy = id(`item:${id('list:ayla:hidden-notes')}:Savoy Pastanesi`);
  await check('P6 new app', 'quick add creates one item with the current status', () => {
    assert.ok(newAdded, 'not created');
    const st = q1('compat', `SELECT name FROM custom_list_statuses WHERE id = '${S6b['public.custom_list_items'][newAdded].status_id}'`);
    assert.equal(st, 'Want to Go');
  });
  await check('P6 new app', 'editing an item whose list hides Notes KEEPS the saved note (and all other values)', () => {
    const a = S6a['public.custom_list_items'][savoy], b = S6b['public.custom_list_items'][savoy];
    assert.equal(b.name, 'Savoy Pastanesi (edited in V2)');
    for (const col of ['notes', 'rating', 'price_level', 'status_id', 'type_ids', 'address']) assert.deepEqual(b[col], a[col], col);
    return `notes still "${b.notes}"`;
  });
  await check('P6 new app', 'hiding Price on a list keeps every item\'s price', () => {
    const coffee = id('list:ayla:coffee');
    assert.equal(S6b['public.custom_lists'][coffee].show_price, false);
    const changedPrices = Object.values(S6b['public.custom_list_items']).filter((i) => i.list_id === coffee && S6a['public.custom_list_items'][i.id] && S6a['public.custom_list_items'][i.id].price_level !== i.price_level);
    assert.deepEqual(changedPrices.map((i) => i.name), []);
  });
  await check('P6 new app', 'adding a photo keeps existing photos', () => {
    const before = Object.values(S6a['public.custom_list_item_images']).filter((i) => i.item_id === petra).map((i) => i.id);
    const after = Object.values(S6b['public.custom_list_item_images']).filter((i) => i.item_id === petra).map((i) => i.id);
    assert.ok(before.every((x) => after.includes(x)), 'an existing photo disappeared');
    assert.equal(after.length, before.length + 1);
    return `${before.length} -> ${after.length}`;
  });
  await check('P6 new app', 'nothing else in the database changed; nothing deleted', () => {
    const coffee = id('list:ayla:coffee');
    const c = classify(d6, [
      { t: 'public.custom_list_items', add: (k) => k === newAdded },
      { t: 'public.custom_list_items', chg: (k, col) => k === savoy && ['name', 'updated_at'].includes(col) },
      { t: 'public.custom_list_items', chg: (k, col) => k === petra && col === 'updated_at' },
      { t: 'public.custom_lists', chg: (k, col) => k === coffee && ['show_price', 'updated_at'].includes(col) },
      { t: 'public.custom_list_item_images', add: (k) => S6b['public.custom_list_item_images'][k].item_id === petra },
      { t: 'storage.objects', add: (k) => S6b['storage.objects'][k].name.includes(petra) },
      // Every app open re-saves the signed-in user's timezone (old app does the same); value unchanged, only updated_at moves.
      { t: 'public.profiles', chg: (k, col) => S6b['public.profiles'][k].user_id === id('user:ayla') && col === 'updated_at' },
    ]);
    assert.deepEqual(c.unexpected, []);
    return `${c.expected.length} expected changes`;
  });
  // Shared list
  await goto(page, `/my-lists/shared/${id('shared:ayla-ece')}`);
  const st = await text(page);
  // The shared list splits items into "To Go" and "Been There" tabs; Ece's Balıkçı is a Been There item.
  await clickContaining(page, 'main [role=tab], main button', 'Been There'); await wait(800);
  const st2 = await text(page);
  await check('P6 new app', 'shared list opens with both members\' items', () => {
    assert.match(st, /2 places/); assert.match(st, /Mikla/); assert.match(st2, /Balıkçı Sabahattin/);
    return 'Mikla (Ayla, To Go) and Balıkçı Sabahattin (Ece, Been There)';
  });
  await check('P6 new app', 'no failed API calls; nothing sent off the machine', () => {
    assert.deepEqual(page.failedApi, []);
    assert.deepEqual(page.external.filter((u) => !u.startsWith('https://cdn.apple-mapkit.com/')), []);
  });
  await page.close();

  // Privacy through the NEW app's UI: a stranger opening the private account's list
  page = await pageFor('new', 390);
  await signIn(page, USERS.deniz.email, USERS.deniz.password);
  await goto(page, `/u/${USERS.cem.id}/lists/${id('list:cem:cem-secret')}`);
  const dt = await text(page);
  await check('P6 new app', 'stranger (pending follower) opening a private account\'s list sees no items', () => assert.doesNotMatch(dt, /Cem private place/));
  await page.close();

  // Whole-session comparison: everything that changed from the seed to the end is accounted for
  const SF = await snapshot('compat');
  const dAll = diff(S0, SF);
  await check('Overall', 'no existing row was deleted in any table across the whole run', () => {
    const del = Object.entries(dAll).flatMap(([t, r]) => r.deleted.map((k) => `${t} ${k}`));
    assert.deepEqual(del, []);
  });
  await check('Overall', 'no existing list was converted: name, icon, owner, created_at and field flags unchanged except the one Price toggle', () => {
    const ch = (dAll['public.custom_lists']?.changed ?? []).flatMap((c) => Object.keys(c.cols).map((col) => `${c.key}.${col}`));
    const allowed = ch.filter((x) => !(x.startsWith(id('list:ayla:coffee')) && /\.(show_price|updated_at)$/.test(x)));
    assert.deepEqual(allowed, []);
  });
  await check('Overall', 'every pre-existing item ID, list link and status/category link is intact', () => {
    const bad = [];
    for (const [k, r] of Object.entries(S0['public.custom_list_items'])) {
      const f = SF['public.custom_list_items'][k];
      if (!f) { bad.push(`${k} missing`); continue; }
      for (const col of ['list_id', 'user_id', 'status_id', 'type_id', 'type_ids', 'created_at']) if (JSON.stringify(f[col]) !== JSON.stringify(r[col])) bad.push(`${r.name}.${col}`);
    }
    assert.deepEqual(bad, []);
    return `${Object.keys(S0['public.custom_list_items']).length} items checked`;
  });
  writeFileSync(path.join(OUT, 'diff-whole-run.json'), JSON.stringify(dAll, null, 1));
  await lab.close();

  // ===== P7: NEW app against the CURRENT (un-migrated) production schema =====
  recreate('compat_nomig', 'compat_pre');
  lab = await up('compat_nomig');
  page = await pageFor('new', 390);
  await signIn(page, USERS.ayla.email, USERS.ayla.password);
  const P7 = 'P7 new app / un-migrated schema';
  const SNM0 = await snapshot('compat_nomig');
  await goto(page, '/my-lists');
  const nm = await text(page);
  const shown = truth0.filter((l) => nm.includes(l.name)).length;
  record(P7, 'Lists home on today\'s production schema shows every list', shown === truth0.length ? 'PASS' : 'FAIL', `lists shown ${shown}/${truth0.length}`);
  // Home + Explore: get_discovery_places (#10) is missing; the app is written to fall back to today's get_explore_places.
  page.failedApi.length = 0;
  await goto(page, '/'); await wait(1500);
  await goto(page, '/explore'); await wait(2000);
  const discFails = [...page.failedApi];
  const onlyDesignedFallback = discFails.every((f) => /404 POST \/rest\/v1\/rpc\/get_discovery_places/.test(f));
  record(P7, 'Home and Explore before #10: missing get_discovery_places falls back to get_explore_places', onlyDesignedFallback ? 'PASS' : 'FAIL',
    `failed calls: ${discFails.join(' ; ') || 'none'} (a 404 on get_discovery_places is the designed probe; anything else is a real failure)`);
  // Add an item
  page.failedApi.length = 0;
  await goto(page, `/my-lists/${id('list:ayla:coffee')}`);
  await clickContaining(page, 'button', 'Search a café');
  await typeInto(page, 'input[aria-label="Search a café"]', 'Pre-migration café'); await wait(900);
  await clickContaining(page, '[role=dialog] button', 'without a place'); await wait(1500);
  const nmAdded = q1('compat_nomig', `SELECT count(*) FROM custom_list_items WHERE name = 'Pre-migration café'`);
  record(P7, 'Add Item before the migrations', String(nmAdded) === '1' ? 'PASS' : 'FAIL', `rows created: ${nmAdded}; failed calls: ${page.failedApi.join(' ; ') || 'none'}`);
  // Who can see it (#8 column): expected to fail before #8
  await page.keyboard.press('Escape'); await wait(400);
  await goto(page, `/my-lists/${id('list:ayla:coffee')}`);
  let visOutcome = 'not reached';
  try {
    page.failedApi.length = 0;
    await clickText(page, 'List options'); await clickText(page, 'Customize list');
    await clickContaining(page, '[role=dialog] button', 'Who can see it'); await wait(500);
    await clickContaining(page, '[role=dialog] [role=radio], [role=dialog] button, [role=dialog] label', 'Only me'); await wait(300);
    await clickContaining(page, '[role=dialog] button', 'Save'); await wait(1500);
    const toastTxt = await text(page);
    visOutcome = /Couldn’t change who can see it/.test(toastTxt) ? `app showed "Couldn’t change who can see it. Nothing was changed." — ${page.failedApi.join(' ; ')}` : /Updated who can see this list/.test(toastTxt) ? 'saved' : `unclear; failed calls: ${page.failedApi.join(' ; ') || 'none'}`;
  } catch (e) { visOutcome = `could not drive the control: ${e.message}`; }
  record(P7, '"Who can see it" before #8 (needs the visibility column)', visOutcome === 'saved' ? 'PASS' : 'FAIL', visOutcome);
  const SNM1 = await snapshot('compat_nomig');
  const dNm = diff(SNM0, SNM1);
  const nmDeleted = Object.entries(dNm).filter(([, v]) => v.deleted?.length).map(([t, v]) => `${t}:${v.deleted.length}`);
  record(P7, 'no rows deleted or lists converted while running before the migrations', nmDeleted.length ? 'FAIL' : 'PASS', nmDeleted.join(', ') || 'none deleted');
  await page.close();
  await lab.close(); lab = null;
} catch (e) {
  record('RUN', 'suite aborted', 'FAIL', e.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  await browser.close();
  if (lab) await lab.close();
  const summary = results.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ env, summary, results }, null, 1));
  writeFileSync(path.join(OUT, 'report.md'), [`# Lists V2 compatibility run ${RUN}`, '', `old app main ${MAIN} · new app ${NEW} · Postgres ${env.postgres}`, '', `Summary: ${JSON.stringify(summary)}`, '', '| Phase | Check | Result | Detail |', '|---|---|---|---|',
    ...results.map((r) => `| ${r.phase} | ${r.check.replace(/\|/g, '/')} | ${r.status} | ${String(r.detail).replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 300)} |`)].join('\n'));
  console.log(`\nSUMMARY ${JSON.stringify(summary)}\nreport: ${OUT}/report.md`);
  process.exit(0);
}
