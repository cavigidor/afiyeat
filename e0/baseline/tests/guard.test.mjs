// The hosted-write guard (lib/approved-target.mjs). No network; uses a temporary approval file.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertApprovedTarget, refOfDbUrl, refOfApiUrl, TargetRefused } from '../../lib/approved-target.mjs';

const REF = 'abcdefghijklmnopqrst', OTHER = 'zyxwvutsrqponmlkjihg', PROD = 'dmlkjpjubneqhbqoxlct';
const dir = mkdtempSync(path.join(tmpdir(), 'e0-guard-'));
const file = path.join(dir, 'approved-target.json');
process.env.E0_APPROVED_TARGET = file;
const NOW = new Date('2026-11-20T12:00:00Z');
const approval = (over = {}) => ({ project_ref: REF, project_url: `https://${REF}.supabase.co`, approved_by: 'PM', approved_on: '2026-11-20',
  expires_on: '2026-12-20', purpose: 'E0 isolated backend', operations: ['load-baseline', 'check'], ...over });
const write = (a) => writeFileSync(file, JSON.stringify(a));
const env = { E0_CONFIRM_PROJECT_REF: REF };
const direct = (ref, extra = '') => `postgresql://postgres:pw@db.${ref}.supabase.co:5432/postgres${extra}`;
const refused = (fn, pattern) => { let e; try { fn(); } catch (x) { e = x; } assert.ok(e instanceof TargetRefused, `expected refusal, got ${e}`); if (pattern) assert.match(e.message, pattern); };

beforeEach(() => write(approval()));

test('G1 the approved project passes for an approved operation (direct and pooler URLs)', () => {
  assert.equal(assertApprovedTarget({ operation: 'load-baseline', dbUrl: direct(REF), now: NOW, env }).project_ref, REF);
  assertApprovedTarget({ operation: 'check', dbUrl: `postgresql://postgres.${REF}:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`, now: NOW, env });
});
test('G2 no approval file: everything is refused', () => {
  rmSync(file);
  refused(() => assertApprovedTarget({ operation: 'check', dbUrl: direct(REF), now: NOW, env }), /no approval file/);
});
test('G3 production is refused even if someone approves it', () => {
  write(approval({ project_ref: PROD, project_url: `https://${PROD}.supabase.co` }));
  refused(() => assertApprovedTarget({ operation: 'check', dbUrl: direct(PROD), now: NOW, env: { E0_CONFIRM_PROJECT_REF: PROD } }), /production/);
});
test('G4 any other project is refused, however the URL is dressed up', () => {
  refused(() => assertApprovedTarget({ operation: 'check', dbUrl: direct(OTHER), now: NOW, env }), /not to the approved project/);
  refused(() => assertApprovedTarget({ operation: 'check', dbUrl: `postgresql://postgres:pw@db.${OTHER}.supabase.co:5432/postgres?x=db.${REF}.supabase.co`, now: NOW, env }), /not to the approved project/);
  refused(() => assertApprovedTarget({ operation: 'check', dbUrl: `postgresql://postgres:pw@db.${REF}.supabase.co.evil.example:5432/postgres`, now: NOW, env }), /not a Supabase project host/);
  refused(() => assertApprovedTarget({ operation: 'check', dbUrl: `postgresql://postgres.${OTHER}:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`, now: NOW, env }), /not to the approved project/);
  refused(() => assertApprovedTarget({ operation: 'check', dbUrl: 'postgresql://postgres:pw@localhost:5432/postgres', now: NOW, env }), /not a Supabase project host/);
});
test('G5 the operator must type the approved ref', () => {
  refused(() => assertApprovedTarget({ operation: 'check', dbUrl: direct(REF), now: NOW, env: {} }), /E0_CONFIRM_PROJECT_REF/);
  refused(() => assertApprovedTarget({ operation: 'check', dbUrl: direct(REF), now: NOW, env: { E0_CONFIRM_PROJECT_REF: OTHER } }), /E0_CONFIRM_PROJECT_REF/);
});
test('G6 operations not listed, expired or future approvals, and over-long approvals are refused', () => {
  refused(() => assertApprovedTarget({ operation: 'apply-pending', dbUrl: direct(REF), now: NOW, env }), /does not cover/);
  refused(() => assertApprovedTarget({ operation: 'check', dbUrl: direct(REF), now: new Date('2026-12-22T00:00:00Z'), env }), /expired/);
  refused(() => assertApprovedTarget({ operation: 'check', dbUrl: direct(REF), now: new Date('2026-11-19T00:00:00Z'), env }), /not yet valid/);
  write(approval({ expires_on: '2027-03-01' }));
  refused(() => assertApprovedTarget({ operation: 'check', dbUrl: direct(REF), now: NOW, env }), /at most 60 days/);
});
test('G7 a malformed approval, or one carrying extra fields (e.g. a key), is refused', () => {
  write(approval({ service_role_key: 'x' }));
  refused(() => assertApprovedTarget({ operation: 'check', dbUrl: direct(REF), now: NOW, env }), /unexpected field/);
  write(approval({ project_url: `https://${OTHER}.supabase.co` }));
  refused(() => assertApprovedTarget({ operation: 'check', dbUrl: direct(REF), now: NOW, env }), /project_url/);
  writeFileSync(file, '{ not json');
  refused(() => assertApprovedTarget({ operation: 'check', dbUrl: direct(REF), now: NOW, env }), /not valid JSON/);
});
test('G8 API URLs must be exactly https://<ref>.supabase.co', () => {
  assert.equal(refOfApiUrl(`https://${REF}.supabase.co`), REF);
  for (const bad of [`http://${REF}.supabase.co`, `https://${REF}.supabase.co/rest/v1`, `https://${REF}.supabase.co:444`, `https://x.${REF}.supabase.co`, `https://${REF}.supabase.com`]) refused(() => refOfApiUrl(bad));
  refused(() => assertApprovedTarget({ operation: 'check', apiUrl: `https://${OTHER}.supabase.co`, now: NOW, env }), /not to the approved project/);
});
test('G9 direct connections need the postgres user and port 5432', () => {
  refused(() => refOfDbUrl(`postgresql://anon:pw@db.${REF}.supabase.co:5432/postgres`), /postgres user/);
  refused(() => refOfDbUrl(`postgresql://postgres:pw@db.${REF}.supabase.co:6000/postgres`), /port 5432/);
  refused(() => refOfDbUrl(`mysql://postgres:pw@db.${REF}.supabase.co:5432/postgres`), /postgresql/);
});
