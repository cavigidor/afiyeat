#!/usr/bin/env node
// E0-b: build a clean, pinned workspace for loading the ISOLATED project. Never connects to any server.
//
//   node baseline/build-baseline.mjs --out <empty dir> --main <40-hex sha> --stack <40-hex sha> --detection <result.json>
//   node baseline/build-baseline.mjs --check --main <sha> --stack <sha> [--detection <result.json>]   in-process build only
//   node baseline/build-baseline.mjs --write-queries                                                 regenerate queries/*.sql
//
// The detection result is the --json output of detect-stack.mjs run on the PRODUCTION export, with verdict
// "consistent", for exactly the same two commits. It says which pending stack migrations production already has.
//
// Workspace layout (every file listed with its sha256 in manifest.json):
//   baseline/NNN_<file>.sql   main's migrations (nine repaired per lib/repairs.json) + the stack migrations
//                             production already has. Loaded in ONE transaction, ending with containment.
//   containment/contain.sql   switches every cron job off and seals private.secrets (same transaction)
//   containment/check.sql     read-only; every row must be ok
//   pending/NNN_<file>.sql    the stack migrations production does NOT have yet, each applied once, later,
//                             each in its own transaction. Nothing else is ever applied.
//   manifest.json             commits, tool versions, inputs and outputs with sha256
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { baselineFiles, pendingFiles, buildDatabase, applyInProcess, resolveRef, REPAIRS } from '../lib/migrations.mjs';
import { exportSql, DEFINITION_SQL, fingerprintOf } from './fingerprint.mjs';
import { validateExport } from '../lib/fingerprint-file.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const here = path.dirname(new URL(import.meta.url).pathname);
const E0 = path.resolve(here, '..');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const die = (msg) => { console.error(`REFUSED: ${msg}`); process.exit(2); };

if (args.includes('--write-queries')) {
  const dir = path.join(here, 'queries');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'fingerprint-export.sql'), exportSql() + '\n');
  for (let i = 1; i <= 4; i++) writeFileSync(path.join(dir, `fingerprint-export-part-${i}-of-4.sql`), exportSql({ part: i, parts: 4 }) + '\n');
  writeFileSync(path.join(dir, 'fingerprint-definitions.sql'), DEFINITION_SQL + '\n');
  console.log('wrote', dir);
  if (!args.includes('--out') && !args.includes('--check')) process.exit(0);
}

const pinned = (name) => {
  const v = opt(name);
  if (!v || !/^[0-9a-f]{40}$/.test(v)) die(`${name} must be a full 40-character commit SHA (pinned input), not a branch name`);
  if (resolveRef(v) !== v) die(`${name} ${v} is not a commit in this repository`);
  return v;
};
const MAIN = pinned('--main'), STACK = pinned('--stack');
const pending = pendingFiles({ ref: STACK, mainRef: MAIN });

function readDetection() {
  const f = opt('--detection');
  if (!f) die('--detection <detect-stack result.json> is required');
  const d = JSON.parse(readFileSync(f, 'utf8'));
  if (d.verdict !== 'consistent' || !Array.isArray(d.matching_state)) die(`detection verdict is "${d.verdict}", not "consistent": resolve every difference first`);
  if (d.main !== MAIN || d.stack !== STACK) die('the detection result was made for different commits');
  for (const n of d.matching_state) if (!pending.some((p) => p.name === n)) die(`detection names ${n}, which is not pending at these commits`);
  return { file: f, sha256: sha256(readFileSync(f)), already: d.matching_state };
}

function toolVersions() {
  const lock = JSON.parse(readFileSync(path.join(E0, 'package-lock.json'), 'utf8'));
  const v = (p) => lock.packages[`node_modules/${p}`]?.version ?? null;
  let git = null; try { git = execFileSync('git', ['--version'], { encoding: 'utf8' }).trim(); } catch {}
  return { node: process.version, git, '@electric-sql/pglite': v('@electric-sql/pglite'), pg: v('pg'), '@supabase/supabase-js': v('@supabase/supabase-js'),
    package_lock_sha256: sha256(readFileSync(path.join(E0, 'package-lock.json'))) };
}

if (opt('--out')) {
  const out = path.resolve(opt('--out'));
  if (existsSync(out) && readdirSync(out).length) die(`${out} is not empty: a workspace is always built clean`);
  const det = readDetection();
  const already = pending.filter((p) => det.already.includes(p.name));
  const later = pending.filter((p) => !det.already.includes(p.name));
  for (const d of ['baseline', 'pending', 'containment']) mkdirSync(path.join(out, d), { recursive: true });
  const files = [];
  const write = (rel, content, source) => { writeFileSync(path.join(out, rel), content); files.push({ path: rel, sha256: sha256(Buffer.from(content)), ...source }); };
  const base = [...baselineFiles({ ref: MAIN }), ...already.map((f) => ({ ...f, rules: [] }))];
  base.forEach((f, i) => write(`baseline/${String(i + 1).padStart(3, '0')}_${f.name}`, f.sql,
    { source: f.name, from: already.includes(f) ? `stack ${STACK}` : `main ${MAIN}`, repaired_with: f.rules }));
  for (const c of ['contain.sql', 'check.sql']) write(`containment/${c}`, readFileSync(path.join(E0, 'containment', c), 'utf8'), { source: `e0/containment/${c}` });
  later.forEach((f, i) => write(`pending/${String(i + 1).padStart(3, '0')}_${f.name}`, f.sql, { source: f.name, from: `stack ${STACK}` }));
  const manifest = {
    kind: 'afiyeat-e0-isolated-workspace', version: 1,
    commits: { main: MAIN, stack: STACK },
    detection: { file: path.basename(det.file), sha256: det.sha256, production_already_has: det.already },
    repairs_sha256: sha256(Buffer.from(JSON.stringify(REPAIRS))),
    tools: toolVersions(),
    baseline_files: base.length, pending_files: later.map((f) => f.name),
    files,
  };
  writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`workspace ${out}\n  baseline: ${base.length} files (main + ${already.length} stack)\n  pending:  ${later.map((f) => f.name).join(', ') || '(none)'}\n  manifest: ${files.length} files hashed`);
}

if (args.includes('--check')) {
  const already = opt('--detection') ? pending.filter((p) => readDetection().already.includes(p.name)) : [];
  const db = await buildDatabase({ mainRef: MAIN });
  try {
    for (const f of already) await applyInProcess(db, f.name, f.sql);
    const fp = validateExport(await fingerprintOf(db), 'in-process baseline');
    console.log(`In-process baseline built with zero errors (${baselineFiles({ ref: MAIN }).length} main files + ${already.length} stack files); fingerprint valid, ${fp.row_count} rows, checksum ${fp.checksum}.`);
    console.log('This is an in-process Postgres. Compare production only with the isolated Supabase project, never with this.');
  } finally { await db.close(); }
}
process.exit(0);
