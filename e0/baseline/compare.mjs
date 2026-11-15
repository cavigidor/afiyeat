#!/usr/bin/env node
// Compare two fingerprint exports (summary or detail) and list every difference.
//   node baseline/compare.mjs production.csv isolated.csv
// Accepts CSV/TSV with a header row, a JSON array, or a pasted Markdown table.
import { readFileSync } from 'node:fs';

function parse(file) {
  const text = readFileSync(file, 'utf8').trim();
  if (text.startsWith('[')) return JSON.parse(text);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !/^\|?\s*:?-{3,}/.test(l.trim()));
  const split = (l) => (l.includes('|') ? l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|') : l.includes('\t') ? l.split('\t') : l.split(','))
    .map((c) => c.trim().replace(/^"|"$/g, ''));
  const header = split(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [header[i], v])));
}
const [a, b] = process.argv.slice(2).map(parse);
const keyOf = (r) => (r.key !== undefined ? `${r.category} ${r.key}` : r.category);
const valOf = (r) => r.def_hash ?? r.category_hash ?? r.def;
const A = new Map(a.map((r) => [keyOf(r), r])), B = new Map(b.map((r) => [keyOf(r), r]));
let diffs = 0;
for (const k of [...new Set([...A.keys(), ...B.keys()])].sort()) {
  const x = A.get(k), y = B.get(k);
  if (!x) { console.log(`only in second: ${k}`); diffs++; }
  else if (!y) { console.log(`only in first:  ${k}`); diffs++; }
  else if (valOf(x) !== valOf(y)) { console.log(`differs:        ${k}${x.objects ? `  (${x.objects} vs ${y.objects} objects)` : ''}`); diffs++; }
}
console.log(diffs ? `\n${diffs} difference(s). Each must be corrected in the isolated backend or recorded in the comparison log.` : 'No differences.');
process.exit(diffs ? 1 : 0);
