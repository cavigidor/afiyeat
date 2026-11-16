#!/usr/bin/env node
// Screenshots of the demo preview (npm run build:demo first) at iPhone widths, for review.
// Serves dist-demo/ on localhost, drives a local Chrome, writes PNGs to preview-shots/.
// No network beyond localhost: the demo build answers every data request in the browser.
//
//   node scripts/preview/shoot.mjs [--widths 320,390] [--only lists,list-wines] [--out preview-shots]
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { SCENES } from './scenes.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const ROOT = path.resolve('dist-demo');
const OUT = path.resolve(opt('--out', 'preview-shots'));
const WIDTHS = opt('--widths', '320,390').split(',').map(Number);
const ONLY = opt('--only', '') ? opt('--only').split(',') : null;
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
if (!existsSync(path.join(ROOT, 'index.html'))) { console.error('Run npm run build:demo first.'); process.exit(2); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try { const body = await readFile(file); res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(body); }
  catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] });
await mkdir(OUT, { recursive: true });
const failures = [];
const consoleErrors = [];
try {
  for (const width of WIDTHS) {
    for (const scene of SCENES) {
      if (ONLY && !ONLY.includes(scene.name)) continue;
      const page = await browser.newPage();
      page.on('pageerror', (e) => consoleErrors.push(`${scene.name}@${width}: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${scene.name}@${width}: ${m.text()}`); });
      page.on('request', (r) => { const u = r.url(); if (!u.startsWith('http://127.0.0.1') && !u.startsWith('data:') && !u.startsWith('blob:')) consoleErrors.push(`${scene.name}@${width}: EXTERNAL REQUEST ${u}`); });
      await page.setViewport({ width, height: scene.height ?? 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      try {
        await page.goto(`${base}?reset#${scene.path}`, { waitUntil: 'networkidle0' });
        await page.evaluate(() => history.replaceState(null, '', location.pathname + location.hash));
        if (scene.steps) await scene.steps(page);
        await new Promise((r) => setTimeout(r, scene.settle ?? 900));
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 0) failures.push(`${scene.name}@${width}: page is ${overflow}px wider than the screen`);
        await page.screenshot({ path: path.join(OUT, `${scene.name}-${width}.png`), fullPage: scene.fullPage ?? false });
      } catch (e) {
        failures.push(`${scene.name}@${width}: ${e.message}`);
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
const external = consoleErrors.filter((e) => e.includes('EXTERNAL REQUEST'));
console.log(`shots in ${OUT}`);
if (consoleErrors.length) console.log(`console errors (${consoleErrors.length}):\n  ${[...new Set(consoleErrors)].slice(0, 30).join('\n  ')}`);
if (failures.length) console.log(`FAILURES:\n  ${failures.join('\n  ')}`);
process.exit(failures.length || external.length ? 1 : 0);
