#!/usr/bin/env node
// Compare two fingerprint exports (version 2) and list every difference.
//
//   node baseline/compare.mjs <first.json>[,<part2.json>...] <second.json>[,<part2.json>...]
//
// Both exports are validated in full first (lib/fingerprint-file.mjs): a truncated, edited, reordered,
// duplicated, filtered or old-format export is rejected and nothing is compared.
// Exit 0 only when every row of every covered category is identical.
// A match speaks ONLY for the categories in COVERAGE; it is printed with the list of what it does not cover.
import { readExport, InvalidExport } from '../lib/fingerprint-file.mjs';
import { COVERAGE, NOT_COVERED } from './fingerprint.mjs';

export function compareExports(a, b) {
  const diffs = [];
  for (const id of [...new Set([...a.map.keys(), ...b.map.keys()])].sort()) {
    const x = a.map.get(id), y = b.map.get(id);
    const [c, k] = id.split('\t');
    if (!x) diffs.push({ c, k, kind: 'only in second', second: y.d });
    else if (!y) diffs.push({ c, k, kind: 'only in first', first: x.d });
    else if (x.h !== y.h) diffs.push({ c, k, kind: 'differs', first: x.d ?? `hash ${x.h}`, second: y.d ?? `hash ${y.h}` });
  }
  return diffs;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [fa, fb] = process.argv.slice(2);
  if (!fa || !fb) { console.error('usage: compare.mjs <first.json>[,part2...] <second.json>[,part2...]'); process.exit(2); }
  let a, b;
  try { a = readExport(...fa.split(',')); b = readExport(...fb.split(',')); }
  catch (e) { if (e instanceof InvalidExport) { console.error(e.message); process.exit(4); } throw e; }
  console.log(`first:  ${a.database}, Postgres ${a.server_version_num}, ${a.generated_at}, ${a.row_count} rows`);
  console.log(`second: ${b.database}, Postgres ${b.server_version_num}, ${b.generated_at}, ${b.row_count} rows`);
  if (a.server_version_num !== b.server_version_num) console.log('NOTE: different Postgres versions; some definitions may print differently (a mismatch here is not proof of a real difference, but must still be explained).');
  const diffs = compareExports(a, b);
  for (const d of diffs) {
    console.log(`\n${d.kind.padEnd(15)} ${d.c} ${d.k}`);
    if (d.first !== undefined) console.log(`  first:  ${String(d.first).replace(/\n/g, '\n          ')}`);
    if (d.second !== undefined) console.log(`  second: ${String(d.second).replace(/\n/g, '\n          ')}`);
  }
  const per = {};
  for (const d of diffs) per[d.c] = (per[d.c] ?? 0) + 1;
  console.log(`\n${diffs.length ? `${diffs.length} difference(s): ${Object.entries(per).map(([c, n]) => `${c} ${n}`).join(', ')}` : 'No differences in any covered category.'}`);
  console.log(`\nCovered (${Object.keys(COVERAGE).length} categories): ${Object.keys(COVERAGE).join(', ')}.`);
  console.log(`NOT covered, whatever this result says:\n  - ${NOT_COVERED.join('\n  - ')}`);
  process.exit(diffs.length ? 1 : 0);
}
