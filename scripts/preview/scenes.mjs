// The screens shot by shoot.mjs. Each scene opens a route of the demo preview and may interact
// with it first. Selectors use visible text or aria labels, as a person would.
const clickText = (text) => async (page) => {
  // Find by visible text or aria-label, then click with the real mouse (Radix menus open on pointer events).
  const handle = await page.evaluateHandle((t) => [...document.querySelectorAll('button, a, [role="tab"], [role="menuitem"], [role="option"], [role="radio"]')]
    .find((e) => (e.textContent?.trim() === t || e.getAttribute('aria-label') === t) && e.getClientRects().length), text);
  const el = handle.asElement();
  if (!el) throw new Error(`nothing to tap labelled "${text}"`);
  await el.click();
  await new Promise((r) => setTimeout(r, 500));
};
export const tap = clickText;

/** Open a list from the Lists page by its tile name. */
const openList = (name) => async (page) => {
  const ok = await page.evaluate((n) => {
    const el = [...document.querySelectorAll('main button')].find((b) => b.querySelector('span span')?.textContent?.trim() === n);
    if (!el) return false;
    el.click();
    return true;
  }, name);
  if (!ok) throw new Error(`no list tile named "${name}"`);
  await new Promise((r) => setTimeout(r, 900));
};

const typeInto = (selector, text) => async (page) => {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.type(text);
  await new Promise((r) => setTimeout(r, 200));
};
const all = (...steps) => async (page) => { for (const s of steps) await s(page); };

export const SCENES = [
  { name: 'new-list', path: '/my-lists', steps: tap('New list') },
  { name: 'new-list-more', path: '/my-lists', steps: all(tap('New list'), tap('More presets')), fullPage: false },
  { name: 'new-list-drinks', path: '/my-lists', steps: all(tap('New list'), tap('Drinks')) },
  { name: 'new-list-travel', path: '/my-lists', steps: all(tap('New list'), tap('Travel')) },
  { name: 'created-drinks', path: '/my-lists', steps: all(tap('New list'), tap('Drinks'), tap('Create list')), settle: 1500 },
  { name: 'home', path: '/' },
  { name: 'profile-notifications', path: '/profile', fullPage: true, settle: 1200 },
  { name: 'lists', path: '/my-lists' },
  { name: 'lists-full', path: '/my-lists', fullPage: true },
  { name: 'my-restaurants', path: '/my-list' },
  { name: 'list-wines', path: '/my-lists', steps: openList('Wines') },
  { name: 'list-drinks', path: '/my-lists', steps: openList('Drinks') },
  { name: 'list-drinks-tried', path: '/my-lists', steps: all(openList('Drinks'), tap('Tried, 5')) },
  { name: 'list-beans-cards', path: '/my-lists', steps: all(openList('Coffee Beans'), tap('Tried, 3')) },
  { name: 'list-shops', path: '/my-lists', steps: openList('Shops I love') },
  { name: 'list-travel', path: '/my-lists', steps: all(openList('Travel'), tap('Visited, 4')) },
  { name: 'list-coffee-shops', path: '/my-lists', steps: openList('Coffee Shops') },
  { name: 'list-books', path: '/my-lists', steps: openList('Books') },
  { name: 'view-menu', path: '/my-lists', steps: all(openList('Shops I love'), async (page) => { await page.click('[aria-label^="View:"]'); await new Promise((r) => setTimeout(r, 400)); }) },
  { name: 'quick-add-drink', path: '/my-lists', steps: all(openList('Drinks'), tap('Add a drink'), typeInto('input[aria-label="Add a drink"]', 'Negroni')) },
  { name: 'quick-add-place', path: '/my-lists', steps: all(openList('Coffee Shops'), tap('Search a café'), typeInto('input[aria-label="Search a café"]', 'cafe')), settle: 1500 },
  { name: 'item-sheet', path: '/my-lists', steps: all(openList('Drinks'), tap('Tried, 5'), async (page) => { await page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent?.includes('Barolo Ravera'))?.click()); await new Promise((r) => setTimeout(r, 700)); }) },
  // Seeds recent destinations the way two earlier adds would, then opens the universal Add item.
  { name: 'add-item-recent', path: '/my-lists', steps: all(async (page) => { await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('afiyeat-demo-db-v1')); const id = d.custom_lists.find((l) => l.name === 'Drinks').id; localStorage.setItem('afiyeat:add-item:recent-destinations', JSON.stringify([`custom:${id}`, 'restaurants'])); localStorage.setItem('afiyeat:add-item:last-destination', `custom:${id}`); }); }, tap('Add item')), settle: 900 },
  { name: 'customize', path: '/my-lists', steps: all(openList('Drinks'), tap('List options'), tap('Customize list')) },
  { name: 'customize-fields', path: '/my-lists', steps: all(openList('Drinks'), tap('List options'), tap('Customize list'), async (page) => { await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent?.startsWith('Fields'))?.click()); await new Promise((r) => setTimeout(r, 400)); }) },
];
