// Headless Chrome driver for the lab. Every request outside 127.0.0.1 is
// blocked and recorded (the lab must never touch production or anything else).
import puppeteer from 'puppeteer-core';
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openBrowser() {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] });
  return browser;
}

export async function newPage(browser, base) {
  // Each page gets its own private context: no shared sign-in or storage between users/apps.
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('close', () => { void ctx.close().catch(() => {}); });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.external = []; page.consoleErrors = []; page.failedApi = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('data:') || u.startsWith('blob:')) return req.continue();
    page.external.push(u.slice(0, 120)); req.abort();
  });
  page.on('console', (m) => { if (m.type() === 'error') page.consoleErrors.push(m.text().slice(0, 300)); });
  page.on('response', async (r) => {
    const u = r.url();
    if (u.includes('/rest/v1/') || u.includes('/storage/v1/')) {
      if (r.status() >= 400 && !(r.status() === 406)) page.failedApi.push(`${r.status()} ${r.request().method()} ${u.replace(base, '').slice(0, 160)}`);
    }
  });
  page.base = base;
  return page;
}

export async function signIn(page, email, password) {
  await page.goto(`${page.base}/auth`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[type=email]', { timeout: 8000 });
  const emailInputs = await page.$$('input[type=email]');
  // The sign-in form is the visible one.
  for (const el of emailInputs) { if (await el.evaluate((e) => e.offsetParent !== null)) { await el.click({ clickCount: 3 }); await el.type(email); break; } }
  const pw = await page.$$('input[type=password]');
  for (const el of pw) { if (await el.evaluate((e) => e.offsetParent !== null)) { await el.type(password); break; } }
  const buttons = await page.$$('button[type=submit]');
  for (const b of buttons) { if (await b.evaluate((e) => e.offsetParent !== null)) { await b.click(); break; } }
  await page.waitForFunction(() => !location.pathname.startsWith('/auth'), { timeout: 10000 });
  await wait(800);
}

export const text = (page) => page.evaluate(() => document.body.innerText);
export async function goto(page, p) { await page.goto(`${page.base}${p}`, { waitUntil: 'networkidle0' }); await wait(900); }
