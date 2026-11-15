#!/usr/bin/env node
// Compare two fingerprint exports (version 2) and list every difference.
//
//   node baseline/compare.mjs <first.json>[,<part2.json>...] <second.json>[,<part2.json>...] [--contained-second]
//
// --contained-second: the second export is the isolated project after containment/contain.sql; cron jobs
// that differ ONLY by being inactive there are reported as "contained" and not counted.
//
// Both exports are validated in full first (lib/fingerprint-file.mjs): a truncated, edited, reordered,
// duplicated, filtered or old-format export is rejected and nothing is compared.
// Exit 0 only when every row of every covered category is identical.
// A match speaks ONLY for the categories in COVERAGE; it is printed with the list of what it does not cover.
import { readExport, InvalidExport } from '../lib/fingerprint-file.mjs';
import { COVERAGE, NOT_COVERED } from './fingerprint.mjs';

// With containedSecond, the ONE expected difference is a cron job that is active in the first export and inactive
// (contained) in the second, with schedule, database and command hash identical. Nothing else is excused.
const sameButContained = (x, y) => typeof x.d === 'string' && typeof y.d === 'string' && y.d.includes('|active=false|')
  && x.d.replace('|active=true|', '|active=false|') === y.d;

export function compareExports(a, b, { containedSecond = false } = {}) {
  const diffs = [];
  for (const id of [...new Set([...a.map.keys(), ...b.map.keys()])].sort()) {
    const x = a.map.get(id), y = b.map.get(id);
    const [c, k] = id.split('\t');
    if (!x) diffs.push({ c, k, kind: 'only in second', second: y.d });
    else if (!y) diffs.push({ c, k, kind: 'only in first', first: x.d });
    else if (x.h !== y.h) {
      if (containedSecond && c === 'cron_job' && sameButContained(x, y)) diffs.push({ c, k, kind: 'contained', expected: true });
      else diffs.push({ c, k, kind: 'differs', first: x.d ?? `hash ${x.h}`, second: y.d ?? `hash ${y.h}` });
    }
  }
  return diffs;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const containedSecond = process.argv.includes('--contained-second');
  const [fa, fb] = files;
  if (!fa || !fb) { console.error('usage: compare.mjs <first.json>[,part2...] <second.json>[,part2...]'); process.exit(2); }
  let a, b;
  try { a = readExport(...fa.split(',')); b = readExport(...fb.split(',')); }
  catch (e) { if (e instanceof InvalidExport) { console.error(e.message); process.exit(4); } throw e; }
  console.log(`first:  ${a.database}, Postgres ${a.server_version_num}, ${a.generated_at}, ${a.row_count} rows`);
  console.log(`second: ${b.database}, Postgres ${b.server_version_num}, ${b.generated_at}, ${b.row_count} rows`);
  if (a.server_version_num !== b.server_version_num) console.log('NOTE: different Postgres versions; some definitions may print differently (a mismatch here is not proof of a real difference, but must still be explained).');
  const all = compareExports(a, b, { containedSecond });
  const contained = all.filter((d) => d.expected), diffs = all.filter((d) => !d.expected);
  if (contained.length) console.log(`contained (expected, not counted): ${contained.length} cron job(s) inactive in the second export: ${contained.map((d) => d.k).join(', ')}`);
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
