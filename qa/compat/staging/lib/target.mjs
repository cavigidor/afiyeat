// The ONLY gate for anything in qa/compat/staging that writes to a hosted Supabase project.
//
// Same rules as e0/lib/approved-target.mjs (branch e0/b-isolated-backend): an allowlist of exactly one
// project, written by the PM. Claude does not create the approval file. It holds no secret.
//
//   qa/compat/staging/approved-target.json   (path overridable with STAGING_APPROVED_TARGET, for the lab test)
//   {
//     "project_ref": "abcdefghijklmnopqrst",
//     "project_url": "https://abcdefghijklmnopqrst.supabase.co",
//     "approved_by": "<name>",
//     "approved_on": "2026-11-20",
//     "expires_on":  "2026-12-20",
//     "purpose": "Afiyeat Lists V2 staging with the PM's own list data",
//     "operations": ["load-own-data", "snapshot", "iphone-build"]
//   }
//
// Before each run the operator also retypes the ref: STAGING_CONFIRM_PROJECT_REF=<ref>.
// Production is refused even if it is named, by ref and by URL.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const PRODUCTION_REF = 'dmlkjpjubneqhbqoxlct';
export const PRODUCTION_URL = `https://${PRODUCTION_REF}.supabase.co`;
export const OPERATIONS = ['load-own-data', 'snapshot', 'iphone-build'];
const here = path.dirname(new URL(import.meta.url).pathname);
export const REPO = path.resolve(here, '..', '..', '..', '..');
export const approvalPath = () => process.env.STAGING_APPROVED_TARGET ?? path.join(here, '..', 'approved-target.json');

export class TargetRefused extends Error {}
const refuse = (msg) => { throw new TargetRefused(`REFUSED: ${msg}`); };

/** Production refs known from the repository itself, plus the fixed one. */
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

/**
 * Lab mode (tests only): STAGING_LAB_URL=http://127.0.0.1:<port> lets the tools run against the local lab
 * gateway. It is accepted only for 127.0.0.1 and never together with an approval file.
 */
export function labTarget() {
  const u = process.env.STAGING_LAB_URL;
  if (!u) return null;
  if (!/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(u)) refuse('STAGING_LAB_URL must be http://127.0.0.1:<port>');
  return { project_ref: 'local-lab', project_url: u, lab: true };
}

export function readApproval(operation, now = new Date()) {
  const lab = labTarget();
  if (lab) return lab;
  const file = approvalPath();
  if (!existsSync(file)) refuse(`no approval file at ${file}. Only the PM creates it, for the staging project.`);
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
  if (now < on) refuse('the approval is not valid yet');
  if (now >= new Date(until.getTime() + 86400000)) refuse(`the approval expired on ${a.expires_on}`);
  if (!Array.isArray(a.operations) || a.operations.some((o) => !OPERATIONS.includes(o))) refuse(`operations must be a subset of ${OPERATIONS.join(', ')}`);
  if (!a.operations.includes(operation)) refuse(`the approval does not cover "${operation}"`);
  if (process.env.STAGING_CONFIRM_PROJECT_REF !== a.project_ref) refuse(`retype the approved ref: STAGING_CONFIRM_PROJECT_REF=${a.project_ref}`);
  return a;
}

/** A Supabase API key for the approved project: refuses keys whose JWT names another project. */
export function checkKeyFor(target, key, kind) {
  if (!key || key.length < 20) refuse(`${kind} key is empty`);
  if (key.includes(PRODUCTION_REF)) refuse(`${kind} key mentions the production project`);
  const parts = key.split('.');
  if (parts.length === 3) {
    let claims = {}; try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); } catch { /* not a JWT */ }
    if (claims.ref && claims.ref !== target.project_ref) refuse(`${kind} key belongs to project ${claims.ref}, not ${target.project_ref}`);
    if (kind === 'service_role' && claims.role && claims.role !== 'service_role') refuse(`that is a ${claims.role} key, not service_role`);
  }
  return key;
}
