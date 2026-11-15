#!/usr/bin/env node
// Load a workspace (build-baseline.mjs --out) into the ISOLATED project. Two steps, always:
//
//   1. dry run - prints the exact plan and changes nothing; save it:
//        node baseline/load.mjs plan  --workspace W --phase baseline > plan-baseline.txt
//   2. apply   - recomputes the plan and refuses unless it is byte-identical to the saved dry run:
//        node baseline/load.mjs apply --workspace W --phase baseline --plan plan-baseline.txt
//   Then the same for --phase pending. Read-only afterwards:
//        node baseline/load.mjs check  --workspace W                containment/check.sql, every row ok
//        node baseline/load.mjs export --out isolated.json          fingerprint export of the isolated project
//        node baseline/load.mjs reset-rehearsal --local-rehearsal  drop the LOCAL rehearsal database only
//
// Hosted target: ISOLATED_DB_URL (direct or pooler connection string of the APPROVED project only),
// ISOLATED_DB_CA (path to that project's CA certificate; TLS is always verified), E0_CONFIRM_PROJECT_REF.
// Every hosted call passes lib/approved-target.mjs first. A plan names the target, so a plan made for one
// project cannot be applied to another.
//
// --local-rehearsal: the same flow against the socket-only local Postgres (concurrency/start-local-pg.sh),
// into a fresh database e0_rehearsal, with Supabase stand-ins loaded first. Never touches a network host.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { assertApprovedTarget, readApproval, refOfDbUrl } from '../lib/approved-target.mjs';
import { STUBS } from '../lib/migrations.mjs';
import { client as localClient } from '../lib/localpg.mjs';
import { exportSql } from './fingerprint.mjs';
import { validateExport } from '../lib/fingerprint-file.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const REHEARSAL = args.includes('--local-rehearsal');
const REHEARSAL_DB = 'e0_rehearsal';
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const die = (m, code = 2) => { console.error(`REFUSED: ${m}`); process.exit(code); };

function workspace() {
  const W = opt('--workspace');
  if (!W || !existsSync(path.join(W, 'manifest.json'))) die('--workspace <dir> with a manifest.json is required');
  const raw = readFileSync(path.join(W, 'manifest.json'));
  const m = JSON.parse(raw);
  if (m.kind !== 'afiyeat-e0-isolated-workspace' || m.version !== 1) die('not an E0 workspace manifest');
  for (const f of m.files) {
    const p = path.join(W, f.path);
    if (!existsSync(p)) die(`workspace file missing: ${f.path}`);
    if (sha256(readFileSync(p)) !== f.sha256) die(`workspace file changed since the manifest was written: ${f.path}`);
  }
  return { W, m, manifestSha: sha256(raw) };
}

function target() {
  if (REHEARSAL) return { label: 'LOCAL REHEARSAL (unix socket only, database e0_rehearsal)', ref: 'local-rehearsal' };
  const url = process.env.ISOLATED_DB_URL;
  if (!url) die('set ISOLATED_DB_URL');
  const a = readApproval();
  const ref = refOfDbUrl(url);
  const u = new URL(url);
  return { label: `${ref} via ${u.hostname}:${u.port || 5432} as ${decodeURIComponent(u.username)} (approval: ${a.approved_by}, ${a.approved_on} to ${a.expires_on})`, ref, url };
}

/** The plan is the complete, deterministic description of what apply will do. */
function plan(phase) {
  if (!['baseline', 'pending'].includes(phase)) die('--phase baseline|pending');
  const { m, manifestSha } = workspace();
  const t = target();
  const L = [];
  L.push('afiyeat-e0 load plan v1');
  L.push(`target:   ${t.label}`);
  L.push(`phase:    ${phase}`);
  L.push(`manifest: sha256 ${manifestSha}`);
  L.push(`commits:  main ${m.commits.main}, stack ${m.commits.stack}`);
  L.push(`tools:    node ${m.tools.node}, pg ${m.tools.pg}, package-lock sha256 ${m.tools.package_lock_sha256}`);
  if (phase === 'baseline') {
    L.push('precondition: the database has no table in schema public (a fresh project) and no E0 load log');
    if (REHEARSAL) L.push('rehearsal only: create database e0_rehearsal if absent; load e0/lib/supabase-stubs.sql; drop CREATE EXTENSION pg_cron/pg_net lines');
    L.push('transaction: ONE transaction for every step below; any error rolls everything back');
    const steps = m.files.filter((f) => f.path.startsWith('baseline/')).concat(m.files.filter((f) => f.path === 'containment/contain.sql'));
    steps.forEach((f, i) => L.push(`  ${String(i + 1).padStart(3)} ${f.sha256} ${f.path}`));
    L.push(`  ${String(steps.length + 1).padStart(3)} record load log: phase baseline, this plan`);
  } else {
    L.push('precondition: the E0 load log holds a baseline load of this same manifest, and no pending load yet');
    L.push('transaction: one transaction per file; stop at the first error');
    const steps = m.files.filter((f) => f.path.startsWith('pending/'));
    if (!steps.length) L.push('  (no pending migrations)');
    steps.forEach((f, i) => L.push(`  ${String(i + 1).padStart(3)} ${f.sha256} ${f.path}  + record load log`));
  }
  L.push('afterwards: node baseline/load.mjs check (every row ok), then export and compare');
  const text = L.join('\n') + '\n';
  return { text, sha: sha256(text), t, phase };
}

async function connect(t, operation) {
  if (REHEARSAL) { const c = localClient(REHEARSAL_DB); await c.connect(); return c; }
  assertApprovedTarget({ operation, dbUrl: t.url });
  const ca = process.env.ISOLATED_DB_CA;
  if (!ca || !existsSync(ca)) die('set ISOLATED_DB_CA to the isolated project\'s CA certificate file (TLS is always verified)');
  const c = new pg.Client({ connectionString: t.url, ssl: { ca: readFileSync(ca, 'utf8'), rejectUnauthorized: true } });
  await c.connect();
  return c;
}

const rehearsalSql = (sql) => (REHEARSAL ? sql.replace(/CREATE EXTENSION IF NOT EXISTS pg_(cron|net)[^;]*;/gi, '') : sql);

async function apply(phase) {
  const p = plan(phase);
  const saved = opt('--plan');
  if (!saved || !existsSync(saved)) die('--plan <file saved from the dry run> is required');
  if (readFileSync(saved, 'utf8') !== p.text) die('the plan differs from the saved dry run (inputs, target or approval changed). Nothing was done.');
  process.stdout.write(p.text);
  const { W, m, manifestSha } = workspace();
  if (REHEARSAL && phase === 'baseline') {
    // Created if absent, never dropped here: a second load must meet the same precondition as a hosted one.
    const admin = localClient('postgres'); await admin.connect();
    const exists = (await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [REHEARSAL_DB])).rows.length;
    if (!exists) await admin.query(`CREATE DATABASE ${REHEARSAL_DB}`);
    await admin.end();
  }
  const c = await connect(p.t, phase === 'baseline' ? 'load-baseline' : 'apply-pending');
  try {
    const hasLog = (await c.query(`SELECT to_regclass('e0_containment.load_log') IS NOT NULL AS x`)).rows[0].x;
    if (phase === 'baseline') {
      const tables = (await c.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`)).rows[0].n;
      if (tables > 0 || hasLog) die(`precondition failed: ${tables} public table(s)${hasLog ? ' and an existing E0 load log' : ''}. Use a fresh project.`, 5);
      if (REHEARSAL && !(await c.query(`SELECT to_regnamespace('auth') IS NOT NULL AS x`)).rows[0].x) await c.query(STUBS.replace(/CREATE ROLE (\w+)([^;]*);/g, (x, r, rest) => `DO $$ BEGIN CREATE ROLE ${r}${rest}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`)
);
      await c.query('BEGIN');
      try {
        for (const f of m.files.filter((x) => x.path.startsWith('baseline/'))) {
          try { await c.query(rehearsalSql(readFileSync(path.join(W, f.path), 'utf8'))); } catch (e) { throw new Error(`${f.path}: ${e.message}`); }
        }
        await c.query(readFileSync(path.join(W, 'containment/contain.sql'), 'utf8'));
        await c.query(`INSERT INTO e0_containment.load_log (phase, plan_sha256, manifest_sha256) VALUES ('baseline', $1, $2)`, [p.sha, manifestSha]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
      console.log('baseline loaded and contained in one transaction');
    } else {
      if (!hasLog) die('precondition failed: no E0 load log; load the baseline first', 5);
      const log = (await c.query(`SELECT phase, manifest_sha256 FROM e0_containment.load_log ORDER BY id`)).rows;
      if (!log.some((r) => r.phase === 'baseline' && r.manifest_sha256 === manifestSha)) die('precondition failed: the baseline was loaded from a different manifest', 5);
      if (log.some((r) => r.phase === 'pending')) die('precondition failed: pending migrations were already applied', 5);
      for (const f of m.files.filter((x) => x.path.startsWith('pending/'))) {
        await c.query('BEGIN');
        try {
          await c.query(readFileSync(path.join(W, f.path), 'utf8'));
          await c.query(`INSERT INTO e0_containment.load_log (phase, plan_sha256, manifest_sha256) VALUES ('pending', $1, $2)`, [p.sha, manifestSha]);
          await c.query('COMMIT');
          console.log(`applied ${f.path}`);
        } catch (e) { await c.query('ROLLBACK'); throw new Error(`${f.path}: ${e.message} (rolled back; stopped)`); }
      }
    }
  } finally { await c.end(); }
}

async function check() {
  const { W } = workspace();
  const c = await connect(target(), 'check');
  try {
    await c.query('BEGIN READ ONLY');
    const rows = (await c.query(readFileSync(path.join(W, 'containment/check.sql'), 'utf8'))).rows;
    await c.query('ROLLBACK');
    for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
    if (rows.some((r) => !r.ok)) { console.error('Containment check FAILED: stop all testing.'); process.exit(1); }
  } finally { await c.end(); }
}

async function exportFp() {
  const out = opt('--out'); if (!out) die('--out <file>');
  const c = await connect(target(), 'check');
  try {
    await c.query('BEGIN READ ONLY');
    const text = (await c.query(exportSql())).rows[0].fingerprint;
    await c.query('ROLLBACK');
    validateExport(JSON.parse(text), 'isolated export');
    writeFileSync(out, text);
    console.log(`wrote ${out}`);
  } finally { await c.end(); }
}

try {
  if (cmd === 'plan') process.stdout.write(plan(opt('--phase')).text);
  else if (cmd === 'apply') await apply(opt('--phase'));
  else if (cmd === 'check') await check();
  else if (cmd === 'export') await exportFp();
  else if (cmd === 'reset-rehearsal') {
    if (!REHEARSAL) die('reset-rehearsal only exists with --local-rehearsal');
    const admin = localClient('postgres'); await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${REHEARSAL_DB} WITH (FORCE)`); await admin.end();
    console.log('dropped the local rehearsal database');
  }
  else die('usage: load.mjs plan|apply|check|export ...');
} catch (e) { console.error(e.message); process.exit(/^REFUSED/.test(e.message) ? 3 : 1); }
process.exit(0);
