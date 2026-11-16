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
