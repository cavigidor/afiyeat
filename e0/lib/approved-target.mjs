// The ONLY gate for anything that writes to, or signs in to, a hosted Supabase project.
//
// An allowlist of exactly one project, written by the PM - not a denylist. Every hosted script calls
// assertApprovedTarget() before it opens a connection. Without a valid approval file nothing runs.
//
// The approval file is e0/staging/approved-target.json (path overridable with E0_APPROVED_TARGET for tests).
// It holds no secret: a project ref, its URL, who approved it, until when, and for which operations.
// It is created by the PM for the isolated project; Claude does not create it.
//
//   {
//     "project_ref": "abcdefghijklmnopqrst",
//     "project_url": "https://abcdefghijklmnopqrst.supabase.co",
//     "approved_by": "<name>",
//     "approved_on": "2026-11-20",
//     "expires_on":  "2026-12-20",
//     "purpose": "Afiyeat Lists V2 E0 isolated backend",
//     "operations": ["load-baseline", "apply-pending", "contain", "check", "security-tests", "concurrency-tests"]
//   }
//
// Before each run the operator also types the ref: E0_CONFIRM_PROJECT_REF=<ref>.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PRODUCTION_REF = 'dmlkjpjubneqhbqoxlct';
export const OPERATIONS = ['load-baseline', 'apply-pending', 'contain', 'check', 'security-tests', 'concurrency-tests'];
const here = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(here, '..', '..');
export const approvalPath = () => process.env.E0_APPROVED_TARGET ?? path.join(REPO, 'e0', 'staging', 'approved-target.json');

export class TargetRefused extends Error {}
const refuse = (msg) => { throw new TargetRefused(`REFUSED: ${msg}`); };

/** Production refs known from the repository itself (.env, supabase/config.toml), plus the fixed one. */
export function productionRefs() {
  const refs = new Set([PRODUCTION_REF]);
  for (const f of ['.env', 'supabase/config.toml']) {
    let t = ''; try { t = readFileSync(path.join(REPO, f), 'utf8'); } catch { continue; }
    for (const re of [/project_id\s*=\s*"([a-z]{20})"/g, /SUPABASE_PROJECT_ID\s*=\s*"?([a-z]{20})"?/g, /https:\/\/([a-z]{20})\.supabase\.co/g]) {
      for (const m of t.matchAll(re)) refs.add(m[1]);
    }
  }
  return refs;
}

export function readApproval(now = new Date()) {
  const file = approvalPath();
  if (!existsSync(file)) refuse(`no approval file at ${file}. Only the PM creates it, for the isolated project.`);
  let a; try { a = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { refuse(`approval file is not valid JSON (${e.message})`); }
  const want = ['project_ref', 'project_url', 'approved_by', 'approved_on', 'expires_on', 'purpose', 'operations'];
  for (const k of want) if (!(k in a)) refuse(`approval file lacks "${k}"`);
  for (const k of Object.keys(a)) if (!want.includes(k)) refuse(`approval file has unexpected field "${k}" (no secrets belong in it)`);
  if (!/^[a-z]{20}$/.test(a.project_ref)) refuse('project_ref must be 20 lower-case letters');
  if (productionRefs().has(a.project_ref)) refuse('the approved project is the production project');
  if (a.project_url !== `https://${a.project_ref}.supabase.co`) refuse(`project_url must be exactly https://${a.project_ref}.supabase.co`);
  if (typeof a.approved_by !== 'string' || a.approved_by.trim().length < 2) refuse('approved_by is required');
  const day = (s, n) => (/^\d{4}-\d\d-\d\d$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? new Date(`${s}T00:00:00Z`) : refuse(`${n} must be YYYY-MM-DD`));
  const on = day(a.approved_on, 'approved_on'), until = day(a.expires_on, 'expires_on');
  if (until <= on) refuse('expires_on must be after approved_on');
  if ((until - on) / 86400000 > 60) refuse('an approval may last at most 60 days');
  if (now < on) refuse('the approval is not yet valid');
  if (now >= new Date(until.getTime() + 86400000)) refuse(`the approval expired on ${a.expires_on}`);
  if (!Array.isArray(a.operations) || !a.operations.length || a.operations.some((o) => !OPERATIONS.includes(o))) refuse(`operations must be a non-empty subset of ${OPERATIONS.join(', ')}`);
  return a;
}

/** Parse a Postgres connection string and return the project ref it can only belong to, or refuse. */
export function refOfDbUrl(dbUrl) {
  let u; try { u = new URL(dbUrl); } catch { refuse('the database URL is not a valid URL'); }
  if (!['postgres:', 'postgresql:'].includes(u.protocol)) refuse('the database URL must start with postgresql://');
  const host = u.hostname.toLowerCase(), user = decodeURIComponent(u.username);
  let m;
  if ((m = host.match(/^db\.([a-z]{20})\.supabase\.co$/))) {
    if (user !== 'postgres') refuse('direct connections must use the postgres user');
    if (!['', '5432'].includes(u.port)) refuse('direct connections must use port 5432');
    return m[1];
  }
  if (/^aws-\d+-[a-z]+-[a-z]+-\d+\.pooler\.supabase\.com$/.test(host)) {
    if (!(m = user.match(/^postgres\.([a-z]{20})$/))) refuse('pooler connections must use the user postgres.<project ref>');
    if (!['5432', '6543'].includes(u.port)) refuse('pooler connections must use port 5432 or 6543');
    return m[1];
  }
  refuse(`database host ${host} is not a Supabase project host`);
}

export function refOfApiUrl(apiUrl) {
  let u; try { u = new URL(apiUrl); } catch { refuse('the API URL is not a valid URL'); }
  const m = u.hostname.match(/^([a-z]{20})\.supabase\.co$/);
  if (u.protocol !== 'https:' || !m || u.port || (u.pathname !== '/' && u.pathname !== '') || u.search || u.username) refuse('the API URL must be exactly https://<ref>.supabase.co');
  return m[1];
}

/**
 * Refuse unless: an approval exists and is valid now; it allows `operation`; the operator typed the same ref;
 * and every URL given resolves to exactly that ref. Returns the approval.
 */
export function assertApprovedTarget({ operation, dbUrl, apiUrl, now = new Date(), env = process.env }) {
  if (!OPERATIONS.includes(operation)) refuse(`unknown operation ${operation}`);
  if (!dbUrl && !apiUrl) refuse('no target given');
  const a = readApproval(now);
  if (!a.operations.includes(operation)) refuse(`the approval does not cover "${operation}"`);
  if (env.E0_CONFIRM_PROJECT_REF !== a.project_ref) refuse('set E0_CONFIRM_PROJECT_REF to the approved project ref (typed by the operator) before every run');
  const refs = productionRefs();
  for (const [label, url, fn] of [['database URL', dbUrl, refOfDbUrl], ['API URL', apiUrl, refOfApiUrl]]) {
    if (!url) continue;
    const ref = fn(url);
    if (refs.has(ref)) refuse(`the ${label} is the production project`);
    if (ref !== a.project_ref) refuse(`the ${label} belongs to ${ref}, not to the approved project ${a.project_ref}`);
  }
  return a;
}

// CLI for shell use:  node lib/approved-target.mjs <operation> [--db-url URL] [--api-url URL]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [operation, ...rest] = process.argv.slice(2);
  const opt = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
  try {
    const a = assertApprovedTarget({ operation, dbUrl: opt('--db-url'), apiUrl: opt('--api-url') });
    console.log(`approved: ${operation} on ${a.project_ref} (approved by ${a.approved_by} on ${a.approved_on}, until ${a.expires_on})`);
  } catch (e) { console.error(e.message); process.exit(3); }
}
