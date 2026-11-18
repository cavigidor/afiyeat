#!/usr/bin/env node
// End-to-end checks of the critical Lists V2 flows, run in the demo preview (real app code, in-browser
// fake backend). Each flow taps through the UI like a person and then asserts on the saved data.
//   npm run build:demo && node scripts/preview/flows.mjs
import assert from 'node:assert/strict';
import { startHarness } from './harness.mjs';
import { tap } from './scenes.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const db = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('afiyeat-demo-db-v1') ?? '{}'));
const listByName = (d, name) => d.custom_lists.find((l) => l.name === name);
async function openList(page, name) {
  const h = await page.evaluateHandle((n) => [...document.querySelectorAll('main button')].find((b) => b.querySelector('span span')?.textContent?.trim() === n), name);
  assert.ok(h.asElement(), `list tile ${name}`);
  await h.asElement().click();
  await wait(900);
}
async function tapContaining(page, scope, text) {
  const h = await page.evaluateHandle((s, t) => [...document.querySelectorAll(s)].find((b) => b.textContent?.includes(t) && b.getClientRects().length), scope, text);
  assert.ok(h.asElement(), `something containing "${text}" in ${scope}`);
  await h.asElement().click();
  await wait(600);
}
async function type(page, selector, text) { await page.click(selector, { clickCount: 3 }); await page.keyboard.type(text); await wait(300); }

const FLOWS = {
  async 'hiding a field keeps its saved values (legacy Wines list)'(page) {
    const before = (await db(page)).custom_list_items.find((i) => i.name === 'Ridge Lytton Springs 2021');
    assert.equal(before.price_manual, 48);
    await openList(page, 'Wines');
    await tap('List options')(page); await tap('Customize list')(page);
    await tapContaining(page, '[role=dialog] button', 'Fields');
    await page.click('[aria-label="Show Price"]'); await wait(600);
    await tap('Done')(page); await wait(400);
    assert.equal(listByName(await db(page), 'Wines').show_price, false);
    // Edit the item while Price is hidden.
    await tap('Tried, 3')(page);
    await tapContaining(page, 'main button', 'Ridge Lytton Springs');
    await tap('Edit details')(page); await wait(500);
    await page.evaluate(() => { const t = document.querySelector('[role=dialog] textarea'); t.focus(); });
    await page.keyboard.type(' Edited.'); await wait(200);
    await tapContaining(page, '[role=dialog] button', 'Save'); await wait(900);
    const after = (await db(page)).custom_list_items.find((i) => i.name === 'Ridge Lytton Springs 2021');
    assert.match(after.notes, /Edited\.$/, 'the edit was saved');
    assert.equal(after.price_manual, 48, 'the hidden price is still there');
    assert.equal(after.rating, 9, 'the rating is untouched');
  },

  async 'quick add saves to the current status and category, and Undo removes it'(page) {
    await openList(page, 'Drinks');
    await tapContaining(page, 'main button', 'Cocktails');
    await tap('Add a drink')(page);
    await type(page, 'input[aria-label="Add a drink"]', 'Negroni');
    await tapContaining(page, '[role=dialog] button[type=submit]', 'Save'); await wait(900);
    const d = await db(page);
    const drinks = listByName(d, 'Drinks');
    const item = d.custom_list_items.find((i) => i.name === 'Negroni');
    assert.ok(item, 'saved');
    const cocktails = d.custom_list_types.find((t) => t.list_id === drinks.id && t.name === 'Cocktails');
    const wantToTry = d.custom_list_statuses.find((s) => s.list_id === drinks.id && s.name === 'Want to Try');
    assert.deepEqual(item.type_ids, [cocktails.id]);
    assert.equal(item.status_id, wantToTry.id);
    const shown = await page.evaluate(() => [...document.querySelectorAll('main button')].some((b) => b.textContent?.includes('Negroni') && !b.textContent.includes('Sbagliato')));
    assert.ok(shown, 'appears in the list');
    await tap('Undo')(page); await wait(900);
    assert.ok(!(await db(page)).custom_list_items.some((i) => i.name === 'Negroni'), 'undo removed it');
  },

  async 'one tap on a place result saves it to the list'(page) {
    await openList(page, 'Coffee Shops');
    await tap('Search a café')(page);
    await type(page, 'input[aria-label="Search a café"]', 'golden'); await wait(900);
    await tapContaining(page, '[role=dialog] button', 'Golden Hour Café'); await wait(1000);
    const item = (await db(page)).custom_list_items.find((i) => i.name === 'Golden Hour Café');
    assert.ok(item, 'saved');
    assert.equal(item.apple_place_id, 'demo-2', 'only the Apple place id is stored for a picked place');
  },

  async 'a new Travel list starts as Only me, with its statuses'(page) {
    await tap('New list')(page); await tap('Travel')(page);
    await tap('Create list')(page); await wait(1200);
    const d = await db(page);
    const travels = d.custom_lists.filter((l) => l.icon === '🌍');
    const created = travels.find((l) => l.name === 'Travel 2');
    assert.ok(created, 'created with a unique name');
    assert.equal(created.visibility, 'private');
    assert.deepEqual(d.custom_list_statuses.filter((s) => s.list_id === created.id).map((s) => s.name), ['Planned', 'Visited']);
    assert.match(await page.evaluate(() => location.hash), new RegExp(created.id));
  },

  async 'universal Add item: explicit Add to an assumed list, then a one-tap recent shortcut'(page) {
    await tap('Add item')(page); await wait(700);
    // The destination is assumed (My Restaurants), so nothing saves until Add is tapped.
    await type(page, '#add-item-search', 'Golden'); await wait(900);
    await tapContaining(page, '[role=dialog] button, [role=dialog] [role=option]', 'Golden Hour');
    let d = await db(page);
    assert.equal(d.restaurants.filter((r) => r.name === 'Golden Hour Café').length, 0, 'picking a result alone saves nothing');
    await tap('Add to My Restaurants')(page); await wait(900);
    d = await db(page);
    const saved = d.restaurants.find((r) => r.name === 'Golden Hour Café');
    assert.ok(saved, 'saved after Add');
    assert.equal(saved.apple_place_id, 'demo-2');
    assert.equal(saved.status, 'to_go');
    // Choose Books once through the picker...
    await tap('Add item')(page); await wait(700);
    await page.click('#add-item-destination'); await wait(400);
    await tapContaining(page, '[role=option]', 'Books'); await wait(500);
    await type(page, '#add-item-name', 'Piranesi');
    await tap('Add to Books')(page); await wait(900);
    // ...then the next add offers My Restaurants and Books as one-tap shortcuts.
    await tap('Add item')(page); await wait(700);
    const chips = await page.$$eval('[role=group][aria-label="Recent lists"] button', (bs) => bs.map((b) => b.textContent.trim()));
    assert.ok(chips.some((c) => c.includes('Books')) && chips.some((c) => c.includes('My Restaurants')), `shortcuts: ${chips}`);
    await tapContaining(page, '[role=group][aria-label="Recent lists"] button', 'My Restaurants');
    await tapContaining(page, '[role=group][aria-label="Recent lists"] button', 'Books');
    await type(page, '#add-item-name', 'The Overstory');
    await tap('Add to Books')(page); await wait(900);
    d = await db(page);
    const books = listByName(d, 'Books');
    for (const n of ['Piranesi', 'The Overstory']) {
      const item = d.custom_list_items.find((i) => i.name === n);
      assert.equal(item?.list_id, books.id, `${n} is on Books`);
      assert.ok(item.status_id, `${n} has a status`);
    }
  },

  async 'photos: picking more than 5 is refused at once; 5 is accepted and the add tile goes away'(page) {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    // Tiny valid PNGs on disk for the file input.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afiyeat-photos-'));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const files = Array.from({ length: 6 }, (_, i) => { const f = path.join(dir, `photo-${i}.png`); fs.writeFileSync(f, png); return f; });
    const toasts = () => page.$$eval('[data-sonner-toast]', (ts) => ts.map((t) => t.textContent.trim()));
    const previews = () => page.$$eval('[role=dialog] img[alt]', (imgs) => imgs.length);

    await tap('Add item')(page); await wait(700);
    await type(page, '#add-item-name', 'Photo test');
    await tapContaining(page, '[role=dialog] button', 'More details');
    const input = await page.$('[role=dialog] input[type=file]');
    assert.ok(input, 'photo input');
    await input.uploadFile(...files); await wait(500);
    assert.ok((await toasts()).some((t) => t.includes('You can only add 5 images.')), `toast: ${await toasts()}`);
    assert.equal(await previews(), 0, 'nothing from the over-limit pick was kept');

    await input.uploadFile(...files.slice(0, 5)); await wait(1500);
    assert.equal(await previews(), 5, 'five accepted');
    assert.equal(await page.$('[role=dialog] button[aria-label="Add photos"]'), null, 'add tile hidden at the cap');
  },

  async 'Profile > Notifications: three daily switches; an opt-out saves and survives a reload'(page) {
    await page.goto(page.url().replace(/[?]reset/, '').replace(/#.*$/, '#/profile'), { waitUntil: 'networkidle0' }); await wait(900);
    const sw = (name) => page.evaluateHandle((n) => [...document.querySelectorAll('[role=switch]')].find((el) => el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent?.includes(n)), name);
    for (const n of ['Good morning fun fact', 'Explore your city', 'Evening exploring']) {
      const h = (await sw(n)).asElement();
      assert.ok(h, `switch ${n}`);
      assert.equal(await h.evaluate((el) => el.getAttribute('aria-checked')), 'true', `${n} on by default`);
    }
    await (await sw('Evening exploring')).asElement().click(); await wait(800);
    const d = await db(page);
    assert.deepEqual((d.notification_opt_outs ?? []).map((r) => r.push_kind), ['evening_explore']);
    await page.reload({ waitUntil: 'networkidle0' }); await wait(900);
    assert.equal(await (await sw('Evening exploring')).asElement().evaluate((el) => el.getAttribute('aria-checked')), 'false', 'still off after reload');
    assert.equal(await (await sw('Good morning fun fact')).asElement().evaluate((el) => el.getAttribute('aria-checked')), 'true');
  },

  async 'existing lists and My Restaurants are unchanged by visiting them'(page) {
    const before = await db(page);
    await openList(page, 'Books'); await page.goBack(); await wait(600);
    await openList(page, 'My Restaurants'); await wait(800);
    const after = await db(page);
    for (const t of ['custom_lists', 'custom_list_items', 'custom_list_statuses', 'custom_list_types', 'restaurants', 'folders', 'shared_lists', 'shared_list_items']) {
      assert.deepEqual(after[t], before[t], `${t} untouched`);
    }
  },
};

const { base, browser, close } = await startHarness();
let failed = 0;
try {
  for (const [name, flow] of Object.entries(FLOWS)) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => { const u = r.url(); if (!/^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(u)) errors.push(`external request ${u}`); });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.goto(`${base}?reset#/my-lists`, { waitUntil: 'networkidle0' });
    try {
      await flow(page);
      assert.deepEqual(errors, [], 'no page errors or outside requests');
      console.log(`ok   ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`);
      await page.screenshot({ path: `preview-shots/FAILED-${name.slice(0, 40).replace(/\W+/g, '-')}.png` });
    }
    await page.close();
  }
} finally { await close(); }
console.log(`${Object.keys(FLOWS).length - failed}/${Object.keys(FLOWS).length} flows passed`);
process.exit(failed ? 1 : 0);
