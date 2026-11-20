#!/usr/bin/env node
// After testing on the iPhone: compares the staging project's copy of your data with
//   (a) the baseline saved right after import (what changed while you tested), and
//   (b) the original export (proves nothing exported was converted, overwritten or deleted).
// READ-ONLY: it only reads staging (GET, and signed links to check photos still exist).
//
//   STAGING_CONFIRM_PROJECT_REF=<ref> node qa/compat/staging/compare-staging.mjs --bundle <export folder> [--label after-iphone]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TABLES, canon, ask } from './lib/common.mjs';

/** Every row of the account's data in staging, by table and id. */
export async function snapshotStaging(api, manifest) {
  const me = manifest.account;
  const all = async (t, filter) => {
    const rows = [];
    for (let off = 0; ; off += 1000) {
      const page = await api('GET', `/rest/v1/${t}?select=*&${filter}&order=id.asc&limit=1000&offset=${off}`);
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  };
  const snap = { taken_at: new Date().toISOString(), tables: {} };
  for (const def of TABLES) {
    let rows;
    if (def.own) rows = await all(def.t, `${def.own}=eq.${me}`);
    else if (def.member) rows = await all(def.t, `or=(${def.member.map((c) => `${c}.eq.${me}`).join(',')})`);
    else { const ids = Object.keys(snap.tables[def.byList] ?? {}); rows = ids.length ? await all(def.t, `list_id=in.(${ids.join(',')})`) : []; }
    snap.tables[def.t] = Object.fromEntries(rows.map((r) => [r.id, r]));
  }
  snap.tables.profiles = Object.fromEntries((await all('profiles', `user_id=eq.${me}`)).map((r) => [r.id, r]));
  snap.photos = [];
  for (const p of manifest.photos.filter((x) => x.sha256)) {
    const s = await api('POST', `/storage/v1/object/sign/${p.bucket}`, { body: { expiresIn: 60, paths: [p.path] } });
    snap.photos.push({ bucket: p.bucket, path: p.path, present: !!s[0]?.signedURL });
  }
  return snap;
}

const isTs = (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:/.test(v);
const same = (a, b) => canon(a) === canon(b) || (isTs(a) && isTs(b) && Date.parse(a) === Date.parse(b));

/** Field-level diff of `before` rows (id -> row) against `after`. */
export function compareRows(before, after) {
  const out = {};
  for (const t of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const A = before[t] ?? {}, B = after[t] ?? {};
    const deleted = Object.keys(A).filter((k) => !(k in B));
    const added = Object.keys(B).filter((k) => !(k in A));
    const changed = [];
    for (const k of Object.keys(A)) {
      if (!(k in B)) continue;
      const cols = Object.keys(A[k]).filter((c) => !same(A[k][c], B[k][c]));
      const newCols = Object.keys(B[k]).filter((c) => !(c in A[k]));
      if (cols.length) changed.push({ id: k, name: B[k].name ?? A[k].name ?? null, cols: Object.fromEntries(cols.map((c) => [c, [A[k][c], B[k][c]]])) });
      if (newCols.length && !out[`${t}:newColumns`]) out[`${t}:newColumns`] = newCols;
    }
    out[t] = { before: Object.keys(A).length, after: Object.keys(B).length, deleted, added, changed };
  }
  return out;
}

async function main() {
  const { readApproval, checkKeyFor } = await import('./lib/target.mjs');
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const bundle = arg('--bundle'), label = arg('--label') ?? 'after-testing';
  const target = readApproval('snapshot');
  const KEY = checkKeyFor(target, target.lab ? process.env.STAGING_SERVICE_ROLE_KEY_LAB : await ask('Staging service_role key (not shown, not saved): ', { hidden: true }), 'service_role');
  const api = async (method, p, { body } = {}) => {
    if (!(method === 'GET' && p.startsWith('/rest/v1/')) && !(method === 'POST' && /^\/storage\/v1\/object\/sign\/[a-z0-9-]+$/.test(p))) throw new Error(`BLOCKED (read-only compare): ${method} ${p}`);
    const r = await fetch(target.project_url + p, { method, body: body && JSON.stringify(body), headers: { apikey: KEY, authorization: `Bearer ${KEY}`, ...(body ? { 'content-type': 'application/json' } : {}) } });
    if (!r.ok) throw new Error(`${method} ${p.split('?')[0]} -> HTTP ${r.status}`);
    return r.json();
  };
  const manifest = JSON.parse(readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
  const exported = JSON.parse(readFileSync(path.join(bundle, 'data.json'), 'utf8'));
  const baseline = JSON.parse(readFileSync(path.join(bundle, 'staging-baseline.json'), 'utf8'));
  const now = await snapshotStaging(api, manifest);
  writeFileSync(path.join(bundle, `staging-${label}.json`), JSON.stringify(now, null, 1));
  const exportedById = Object.fromEntries(Object.entries(exported).map(([t, rows]) => [t, Object.fromEntries(rows.map((r) => [r.id, r]))]));
  const sinceBaseline = compareRows(baseline.tables, now.tables);
  const sinceExport = compareRows(exportedById, now.tables);
  const lines = [`# Staging comparison: ${label}`, '', `staging ${target.project_url} · export ${manifest.exported_at} · baseline ${baseline.taken_at} · now ${now.taken_at}`, ''];
  lines.push('| Table | exported | baseline | now | exported rows deleted | exported rows changed | rows added |', '|---|---|---|---|---|---|---|');
  for (const def of [...TABLES, { t: 'profiles' }]) {
    const e = sinceExport[def.t] ?? { before: 0, deleted: [], changed: [] }, b = sinceBaseline[def.t] ?? { before: 0, after: 0, added: [] };
    lines.push(`| ${def.t} | ${e.before} | ${b.before} | ${b.after} | ${e.deleted.length} | ${e.changed.length} | ${b.added.length} |`);
  }
  const listCols = ['name', 'icon', 'color', 'user_id', 'created_at', 'show_location', 'show_notes', 'show_photos', 'show_price', 'price_mode', 'show_rating', 'rating_mode', 'status_todo_label', 'status_done_label'];
  const converted = (sinceExport.custom_lists?.changed ?? []).filter((c) => Object.keys(c.cols).some((k) => listCols.includes(k)));
  lines.push('', '## Checks', '',
    `- Exported rows deleted: **${Object.values(sinceExport).reduce((n, v) => n + (v.deleted?.length ?? 0), 0)}**`,
    `- Lists whose name, icon, owner or field settings changed: **${converted.length}**${converted.length ? ' (listed below; confirm each was your own edit on the iPhone)' : ''}`,
    `- Photos from the export still present: **${now.photos.filter((p) => p.present).length}/${now.photos.length}**`,
    `- New columns on existing lists (from the pending migrations): ${(sinceExport['custom_lists:newColumns'] ?? []).join(', ') || 'none'}`,
    '', '## Every change to an exported row (field: exported → now)', '');
  for (const [t, v] of Object.entries(sinceExport)) for (const c of v.changed ?? []) lines.push(`- ${t} ${c.id}${c.name ? ` "${c.name}"` : ''}: ${Object.entries(c.cols).map(([k, [a, b]]) => `${k}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`).join('; ')}`);
  for (const [t, v] of Object.entries(sinceExport)) for (const id of v.deleted ?? []) lines.push(`- **DELETED** ${t} ${id}`);
  const md = lines.join('\n');
  writeFileSync(path.join(bundle, `compare-${label}.md`), md);
  console.log(md);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
