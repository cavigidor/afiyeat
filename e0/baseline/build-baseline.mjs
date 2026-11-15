#!/usr/bin/env node
// E0-b: reconstruct production's schema baseline for an ISOLATED backend, and check it in-process.
//
//   node baseline/build-baseline.mjs --out <dir> [--with <migration>,...]   write the SQL files to load, in order
//   node baseline/build-baseline.mjs --check [--with <migration>,...]       build in-process, print the fingerprint summary
//   node baseline/build-baseline.mjs --write-queries                         regenerate baseline/queries/*.sql
//
// The baseline is: every migration on origin/main, in order, nine of them repaired per lib/repairs.json,
// PLUS only those pending stack migrations that stack-signatures.sql shows production ALREADY has (--with).
// Pending migrations production does not have are NOT in the baseline: they are applied afterwards, once.
// This script never connects to any server.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { baselineFiles, pendingFiles, buildDatabase } from '../lib/migrations.mjs';
import { SUMMARY_SQL, DETAIL_SQL, DEFINITION_SQL } from './fingerprint.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const MAIN = opt('--main') ?? 'origin/main';
const STACK = opt('--stack') ?? 'origin/stack/14-photo-records-owner-check';
const WITH = (opt('--with') ?? '').split(',').filter(Boolean);
const here = path.dirname(new URL(import.meta.url).pathname);

const pending = pendingFiles({ ref: STACK, mainRef: MAIN });
for (const w of WITH) if (!pending.some((p) => p.name.startsWith(w))) throw new Error(`--with ${w}: not a pending stack migration`);
const already = pending.filter((p) => WITH.some((w) => p.name.startsWith(w)));
const toApplyLater = pending.filter((p) => !already.includes(p));

if (args.includes('--write-queries')) {
  const dir = path.join(here, 'queries');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'fingerprint-1-summary.sql'), SUMMARY_SQL + '\n');
  writeFileSync(path.join(dir, 'fingerprint-2-detail.sql'), DETAIL_SQL + '\n');
  writeFileSync(path.join(dir, 'fingerprint-3-definitions.sql'), DEFINITION_SQL + '\n');
  console.log('wrote', dir);
}

if (opt('--out')) {
  const out = opt('--out');
  mkdirSync(out, { recursive: true });
  const files = [...baselineFiles({ ref: MAIN }), ...already.map((f) => ({ ...f, rules: [] }))];
  const manifest = files.map((f, i) => {
    const file = `${String(i + 1).padStart(3, '0')}_${f.name}`;
    // pg_cron / pg_net: created by the platform on Supabase; the CREATE EXTENSION lines are kept.
    writeFileSync(path.join(out, file), f.sql);
    return { order: i + 1, file, source: f.name, repaired_with: f.rules };
  });
  writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({
    baseline: `origin/main (${MAIN}) + pending stack migrations already in production`,
    already_in_production: already.map((f) => f.name),
    apply_afterwards_in_order: toApplyLater.map((f) => f.name),
    files: manifest,
  }, null, 2));
  console.log(`wrote ${files.length} files to ${out}; afterwards apply: ${toApplyLater.map((f) => f.name).join(', ') || '(nothing)'}`);
}

if (args.includes('--check')) {
  const db = await buildDatabase({ mainRef: MAIN, stackRef: STACK, include: already.map((f) => f.name) });
  const rows = (await db.query(SUMMARY_SQL.replace('-- READ ONLY\n', ''))).rows;
  console.log(`In-process baseline built with zero errors (${baselineFiles({ ref: MAIN }).length} main files + ${already.length} stack files).`);
  console.log('Fingerprint summary (in-process Postgres; compare production only with the isolated SUPABASE backend, not with this):');
  for (const r of rows) console.log(`  ${r.category.padEnd(15)} ${String(r.objects).padStart(4)}  ${r.category_hash}`);
}
