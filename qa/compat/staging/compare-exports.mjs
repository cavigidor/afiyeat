#!/usr/bin/env node
// Compares two read-only exports of the same account (export-own-data.mjs), entirely offline.
// Use it after the TestFlight check: export again, then
//
//   node compare-exports.mjs ~/AfiyeatTrial/own-data-2026-11-20 ~/AfiyeatTrial/own-data-<after> [--out report.md]
//
// It reports, per table: rows deleted, rows added, and every changed field (old -> new), plus
// photos whose file disappeared or changed. Your own test actions show up as changes; anything
// you didn't do is a finding. Names and notes are shown only in the report file on your Mac.
// Lists V2 adds columns (visibility, discovery_token): they're reported once as "new columns", not as changes.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [A, B] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const oi = process.argv.indexOf('--out');
if (!A || !B) { console.error('usage: compare-exports.mjs <before export> <after export> [--out report.md]'); process.exit(2); }
const load = (dir) => ({ data: JSON.parse(readFileSync(path.join(dir, 'data.json'), 'utf8')), manifest: JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) });
const a = load(A), b = load(B);
if (a.manifest.account !== b.manifest.account) { console.error('STOPPED: the two exports are of different accounts'); process.exit(2); }

const isTs = (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:/.test(v);
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y) || (isTs(x) && isTs(y) && Date.parse(x) === Date.parse(y));
const label = (r) => r.name ?? r.comment ?? r.image_url?.split('/').pop() ?? r.username ?? '';
const fmt = (v) => (v === null || v === undefined ? '∅' : JSON.stringify(v).slice(0, 80));
// Columns that change on their own and say nothing about your data
const NOISE = new Set(['updated_at']);
// Other people are pseudonymised with a fresh, unlinkable salt in every export, so their ids (and the
// "Member N" labels in redacted text) differ between exports by design. Compare those columns only
// when they hold YOUR id; skip redacted text written by someone else.
const ME = a.manifest.account;
const PSEUDO = { follows: ['follower_id', 'following_id'], blocked_users: ['blocked_id'], shared_lists: ['user_a', 'user_b'], shared_list_items: ['added_by'], shared_list_item_comments: ['user_id'] };
const AUTHOR = { shared_list_items: 'added_by', shared_list_item_comments: 'user_id' };
const comparable = (t, c, x, y) => {
  if (PSEUDO[t]?.includes(c)) return x === ME || y === ME;
  if (AUTHOR[t] && ['name', 'comment', 'notes'].includes(c)) return false; // compared below only for your own rows
  return true;
};

const lines = [`# Export comparison`, '', `before: ${a.manifest.exported_at} · after: ${b.manifest.exported_at} · account ${a.manifest.account.slice(0, 8)}`, ''];
const summary = [];
let deletedTotal = 0;
const tables = [...new Set([...Object.keys(a.data), ...Object.keys(b.data)])];
lines.push('| Table | before | after | deleted | added | changed |', '|---|---|---|---|---|---|');
const detail = [];
for (const t of tables) {
  const A1 = Object.fromEntries((a.data[t] ?? []).map((r) => [r.id, r]));
  const B1 = Object.fromEntries((b.data[t] ?? []).map((r) => [r.id, r]));
  const deleted = Object.keys(A1).filter((k) => !(k in B1));
  const added = Object.keys(B1).filter((k) => !(k in A1));
  const changed = [];
  const newCols = new Set();
  for (const k of Object.keys(A1)) {
    if (!(k in B1)) continue;
    for (const c of Object.keys(B1[k])) if (!(c in A1[k])) newCols.add(c);
    const own = !AUTHOR[t] || A1[k][AUTHOR[t]] === ME;
    const cols = Object.keys(A1[k]).filter((c) => !NOISE.has(c) && (comparable(t, c, A1[k][c], B1[k][c]) || (own && AUTHOR[t] && ['name', 'comment', 'notes'].includes(c))) && !same(A1[k][c], B1[k][c]));
    if (cols.length) changed.push({ k, cols });
  }
  deletedTotal += deleted.length;
  lines.push(`| ${t} | ${Object.keys(A1).length} | ${Object.keys(B1).length} | ${deleted.length} | ${added.length} | ${changed.length} |`);
  if (newCols.size) summary.push(`${t}: new columns ${[...newCols].join(', ')} (from the migrations)`);
  for (const k of deleted) detail.push(`- **DELETED** ${t} ${k.slice(0, 8)} "${label(A1[k])}"`);
  for (const k of added) detail.push(`- added ${t} ${k.slice(0, 8)} "${label(B1[k])}"`);
  for (const { k, cols } of changed) detail.push(`- changed ${t} ${k.slice(0, 8)} "${label(B1[k])}": ${cols.map((c) => `${c} ${fmt(A1[k][c])} → ${fmt(B1[k][c])}`).join('; ')}`);
}
// Photo files: same id must still have the same bytes
const pa = Object.fromEntries(a.manifest.photos.map((p) => [p.id, p]));
const pb = Object.fromEntries(b.manifest.photos.map((p) => [p.id, p]));
const photoIssues = [];
for (const [id, p] of Object.entries(pa)) {
  if (!p.sha256) continue;
  const q = pb[id];
  if (!q) continue; // the photo row itself was deleted: reported above
  if (!q.sha256) photoIssues.push(`- **PHOTO FILE MISSING** ${p.table} ${id.slice(0, 8)} (${q.missing ?? 'not downloadable'})`);
  else if (q.sha256 !== p.sha256) photoIssues.push(`- **PHOTO FILE CHANGED** ${p.table} ${id.slice(0, 8)}`);
}
lines.push('', '## Verdict', '',
  `- Rows deleted: **${deletedTotal}**`,
  `- Photo files missing or changed: **${photoIssues.length}**`,
  ...summary.map((s) => `- ${s}`),
  '', 'Every change below should be something you did during the test. Anything else is a finding.', '',
  '## Changes', '', ...(detail.length ? detail : ['- none']), ...(photoIssues.length ? ['', '## Photo files', '', ...photoIssues] : []));
const md = lines.join('\n');
const out = oi > 0 ? process.argv[oi + 1] : path.join(B, 'compare-with-before.md');
writeFileSync(out, md);
console.log(md);
console.log(`\nsaved: ${out}`);
