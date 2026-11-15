#!/usr/bin/env node
// After `npx vite build --mode staging`, prove the bundle talks to the isolated backend and NOT production.
//   node e0/staging/check-build-target.mjs [dist]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const PRODUCTION_REF = 'dmlkjpjubneqhbqoxlct';
const root = path.resolve(new URL('.', import.meta.url).pathname, '..', '..');
const dist = path.resolve(process.argv[2] ?? path.join(root, 'dist'));
const local = (() => { try { return readFileSync(path.join(root, '.env.staging.local'), 'utf8'); } catch { return ''; } })();
const isolatedUrl = (local.match(/^VITE_SUPABASE_URL\s*=\s*"?([^"\n]+)"?/m) ?? [])[1];
if (!isolatedUrl || isolatedUrl.includes(PRODUCTION_REF) || isolatedUrl.includes('<')) {
  console.error('.env.staging.local is missing, unfilled, or points at production.'); process.exit(2);
}
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(js|html)$/.test(f) && files.push(p); } };
walk(dist);
const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');
const hasProd = text.includes(PRODUCTION_REF);
const hasIsolated = text.includes(new URL(isolatedUrl).host);
console.log(`${files.length} files checked in ${dist}`);
console.log(`production project ref present: ${hasProd}`);
console.log(`isolated host present:          ${hasIsolated}`);
if (hasProd || !hasIsolated) { console.error('FAIL: do not install this build.'); process.exit(1); }
console.log('OK: this build targets the isolated backend only.');
