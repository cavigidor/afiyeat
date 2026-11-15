// End-to-end rehearsal of the isolated-project load on the LOCAL socket-only Postgres:
// detect -> workspace -> dry run -> apply baseline (one transaction + containment) -> check -> pending -> check.
// Needs: ./concurrency/start-local-pg.sh. Never touches a network host.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildDatabase, pendingFiles, resolveRef } from '../../lib/migrations.mjs';
import { EXPORT_SQL } from '../fingerprint.mjs';

const E0 = path.resolve(new URL('../..', import.meta.url).pathname);
const STACK = process.env.E0_STACK_REF ?? 'origin/stack/14-photo-records-owner-check';
const T = mkdtempSync(path.join(tmpdir(), 'e0-rehearsal-'));
const node = (...a) => spawnSync(process.execPath, a, { cwd: E0, encoding: 'utf8', env: { ...process.env, E0_APPROVED_TARGET: path.join(T, 'none.json') } });
const ok = (r) => { assert.equal(r.status, 0, r.stderr || r.stdout); return r.stdout; };
const W = path.join(T, 'ws'), R = ['--workspace', W, '--local-rehearsal'];

before(async () => {
  execFileSync(path.join(E0, 'concurrency/start-local-pg.sh'), { stdio: 'ignore' });
  const two = pendingFiles({ ref: STACK }).slice(0, 2).map((f) => f.name);
  const db = await buildDatabase({ stackRef: STACK, include: two });
  try { writeFileSync(path.join(T, 'prod.json'), (await db.query(EXPORT_SQL)).rows[0].fingerprint); } finally { await db.close(); }
  const main = resolveRef('origin/main'), stack = resolveRef(STACK);
  const d = node('baseline/detect-stack.mjs', path.join(T, 'prod.json'), '--main', main, '--stack', stack, '--json', path.join(T, 'det.json'));
  ok(d);
  ok(node('baseline/build-baseline.mjs', '--out', W, '--main', main, '--stack', stack, '--detection', path.join(T, 'det.json')));
  ok(node('baseline/load.mjs', 'reset-rehearsal', '--local-rehearsal'));
});

test('W1 the workspace refuses branch names, a non-empty folder and a non-consistent detection', () => {
  const r1 = node('baseline/build-baseline.mjs', '--out', path.join(T, 'x'), '--main', 'origin/main', '--stack', STACK, '--detection', path.join(T, 'det.json'));
  assert.equal(r1.status, 2); assert.match(r1.stderr, /40-character commit SHA/);
  const main = resolveRef('origin/main'), stack = resolveRef(STACK);
  const r2 = node('baseline/build-baseline.mjs', '--out', W, '--main', main, '--stack', stack, '--detection', path.join(T, 'det.json'));
  assert.equal(r2.status, 2); assert.match(r2.stderr, /not empty/);
  const bad = JSON.parse(readFileSync(path.join(T, 'det.json'), 'utf8')); bad.verdict = 'no-matching-state';
  writeFileSync(path.join(T, 'bad.json'), JSON.stringify(bad));
  const r3 = node('baseline/build-baseline.mjs', '--out', path.join(T, 'y'), '--main', main, '--stack', stack, '--detection', path.join(T, 'bad.json'));
  assert.equal(r3.status, 2); assert.match(r3.stderr, /not "consistent"/);
});

test('W2 the dry run is deterministic, and apply refuses without it or with any change', () => {
  const p1 = ok(node('baseline/load.mjs', 'plan', ...R, '--phase', 'baseline'));
  const p2 = ok(node('baseline/load.mjs', 'plan', ...R, '--phase', 'baseline'));
  assert.equal(p1, p2);
  writeFileSync(path.join(T, 'plan-b.txt'), p1);
  writeFileSync(path.join(T, 'plan-x.txt'), p1.replace('ONE transaction', 'one transaction'));
  const r = node('baseline/load.mjs', 'apply', ...R, '--phase', 'baseline', '--plan', path.join(T, 'plan-x.txt'));
  assert.equal(r.status, 2); assert.match(r.stderr, /differs from the saved dry run/);
  const f = path.join(W, 'baseline', '001_' + readFileSync(path.join(W, 'manifest.json'), 'utf8').match(/"source": "([^"]+)"/)[1]);
  copyFileSync(f, path.join(T, 'keep.sql')); appendFileSync(f, '\n-- changed');
  const r2 = node('baseline/load.mjs', 'plan', ...R, '--phase', 'baseline');
  assert.equal(r2.status, 2); assert.match(r2.stderr, /changed since the manifest/);
  copyFileSync(path.join(T, 'keep.sql'), f);
});

test('W3 baseline load: one transaction, contained, refuses a second time; pending applies once', () => {
  assert.match(ok(node('baseline/load.mjs', 'apply', ...R, '--phase', 'baseline', '--plan', path.join(T, 'plan-b.txt'))), /contained in one transaction/);
  const again = node('baseline/load.mjs', 'apply', ...R, '--phase', 'baseline', '--plan', path.join(T, 'plan-b.txt'));
  assert.equal(again.status, 5);
  const check1 = ok(node('baseline/load.mjs', 'check', ...R));
  assert.equal((check1.match(/^ok /gm) ?? []).length, 8, check1);
  const pp = ok(node('baseline/load.mjs', 'plan', ...R, '--phase', 'pending'));
  writeFileSync(path.join(T, 'plan-p.txt'), pp);
  const applied = ok(node('baseline/load.mjs', 'apply', ...R, '--phase', 'pending', '--plan', path.join(T, 'plan-p.txt')));
  assert.equal((applied.match(/^applied /gm) ?? []).length, 3);
  assert.equal(node('baseline/load.mjs', 'apply', ...R, '--phase', 'pending', '--plan', path.join(T, 'plan-p.txt')).status, 5);
  const check2 = ok(node('baseline/load.mjs', 'check', ...R));
  assert.equal((check2.match(/^ok /gm) ?? []).length, 8, check2);
});

test('W4 hosted commands refuse without an approval, before any connection', () => {
  const r = spawnSync(process.execPath, ['baseline/load.mjs', 'plan', '--workspace', W, '--phase', 'baseline'], { cwd: E0, encoding: 'utf8',
    env: { ...process.env, E0_APPROVED_TARGET: path.join(T, 'none.json'), ISOLATED_DB_URL: 'postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres' } });
  assert.equal(r.status, 3); assert.match(r.stderr, /no approval file/);
});
