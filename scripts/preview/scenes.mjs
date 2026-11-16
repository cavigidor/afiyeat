// The screens shot by shoot.mjs. Each scene opens a route of the demo preview and may interact
// with it first. Selectors use visible text or aria labels, as a person would.
const clickText = (text) => async (page) => {
  const ok = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('button, a, [role="tab"], [role="menuitem"], [role="option"]')].find((e) => e.textContent?.trim() === t || e.getAttribute('aria-label') === t);
    if (!el) return false;
    el.click();
    return true;
  }, text);
  if (!ok) throw new Error(`nothing to tap labelled "${text}"`);
  await new Promise((r) => setTimeout(r, 500));
};
export const tap = clickText;

export const SCENES = [
  { name: 'lists', path: '/my-lists' },
  { name: 'lists-full', path: '/my-lists', fullPage: true },
  { name: 'my-restaurants', path: '/my-list' },
  { name: 'list-wines', path: '/my-lists/c1000000-0000-4000-8000-000000000020' },
];
