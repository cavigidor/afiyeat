#!/usr/bin/env node
// After `npx vite build --mode staging`, prove the bundle talks to the isolated backend and NOT production.
//   node e0/staging/check-build-target.mjs [dist]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { readApproval, productionRefs } from '../lib/approved-target.mjs';

const local = (() => { try { return readFileSync(path.join(root, '.env.staging.local'), 'utf8'); } catch { return ''; } })();
const isolatedUrl = (local.match(/^VITE_SUPABASE_URL\s*=\s*"?([^"\n]+)"?/m) ?? [])[1];
let approval;
try { approval = readApproval(); } catch (e) { console.error(e.message); process.exit(3); }
if (isolatedUrl !== approval.project_url) {
  console.error(`.env.staging.local must name exactly the approved project (${approval.project_url}); it names ${isolatedUrl ?? 'nothing'}.`); process.exit(2);
}
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(js|html)$/.test(f) && files.push(p); } };
walk(dist);
const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');
const hasProd = [...productionRefs()].some((r) => text.includes(r));
const hasIsolated = text.includes(new URL(isolatedUrl).host);
console.log(`${files.length} files checked in ${dist}`);
console.log(`production project ref present: ${hasProd}`);
console.log(`isolated host present:          ${hasIsolated}`);
if (hasProd || !hasIsolated) { console.error('FAIL: do not install this build.'); process.exit(1); }
console.log('OK: this build targets the isolated backend only.');
