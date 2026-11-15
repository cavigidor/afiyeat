#!/usr/bin/env node
// Which pending integration-stack migrations does a database already contain?
//
//   node baseline/detect-stack.mjs <export.json> [<part-2.json> ...] [--main <ref>] [--stack <ref>] [--json <out.json>]
//
// Input: one fingerprint export (queries/fingerprint-export.sql), validated in full first.
// Method: build every possible state in-process (main + each subset of the pending migrations), find the
// MATERIAL objects (every fingerprint row whose definition differs between any two states - including the
// complete set of policies that applies to each table and command), and compare the export's material
// objects with each state, definition by definition. Nothing is inferred from names or substrings.
//
// Verdicts per migration:
//   present / absent - only when exactly ONE state matches every material object;
//   review           - otherwise. Then nothing may be loaded or applied until a person has read the evidence.
// This script never connects to any server.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readExport } from '../lib/fingerprint-file.mjs';
import { stackStates, materialKeys, keysTouchedBy } from '../lib/stack-states.mjs';
import { COVERAGE, NOT_COVERED } from './fingerprint.mjs';

const val = (fp, k) => fp.map.get(k)?.h ?? 'ABSENT';

export function classify(prod, info) {
  const { states, pending } = info;
  const material = materialKeys(states);
  const built = states.filter((s) => s.fp);
  const scored = built.map((s) => ({ state: s, diffs: material.filter((k) => val(prod, k) !== val(s.fp, k)) }))
    .sort((a, b) => a.diffs.length - b.diffs.length);
  const exact = scored.filter((x) => x.diffs.length === 0);
  const verdict = exact.length === 1 ? 'consistent' : exact.length === 0 ? 'no-matching-state' : 'ambiguous';
  const perMigration = pending.map((name, i) => {
    const touched = keysTouchedBy(states, i);
    const withI = built.filter((s) => s.mask & (1 << i)), withoutI = built.filter((s) => !(s.mask & (1 << i)));
    const objects = touched.map((k) => {
      const p = val(prod, k);
      const asApplied = withI.some((s) => val(s.fp, k) === p), asNotApplied = withoutI.some((s) => val(s.fp, k) === p);
      return { key: k.replace('\t', ' '), production: p === 'ABSENT' ? 'absent' : p.slice(0, 8),
        matches: asApplied && asNotApplied ? 'both' : asApplied ? 'applied' : asNotApplied ? 'not-applied' : 'neither' };
    });
    const v = verdict === 'consistent' ? (exact[0].state.mask & (1 << i) ? 'present' : 'absent') : 'review';
    return { migration: name, verdict: v, objects };
  });
  const nearest = scored.slice(0, 3).map((x) => ({
    applied: x.state.applied, differing: x.diffs.length,
    diffs: x.diffs.slice(0, 25).map((k) => {
      const exp = x.state.fp.map.get(k), got = prod.map.get(k);
      return { key: k.replace('\t', ' '), expected: exp?.d ?? (exp ? `hash ${exp.h}` : 'absent'), production: got?.d ?? (got ? `hash ${got.h}` : 'absent') };
    }),
  }));
  return {
    verdict, matching_state: exact.length === 1 ? exact[0].state.applied : null,
    material_objects: material.length, unbuildable_states: states.filter((s) => s.error).map((s) => ({ applied: s.applied, error: s.error })),
    perMigration, nearest,
  };
}

function print(r, info, prod) {
  console.log(`Inputs: main ${info.main}, stack ${info.stack}; export from ${prod.database}, Postgres ${prod.server_version_num}, ${prod.generated_at}`);
  console.log(`Material objects compared: ${r.material_objects} (every definition that differs between any two possible states)`);
  console.log(`Overall: ${r.verdict}${r.matching_state ? ` - matches main + [${r.matching_state.join(', ') || 'none'}]` : ''}\n`);
  for (const m of r.perMigration) {
    const n = (w) => m.objects.filter((o) => o.matches === w).length;
    console.log(`${m.verdict.padEnd(8)} ${m.migration}  (${m.objects.length} objects: ${n('applied')} as-applied, ${n('not-applied')} as-not-applied, ${n('both')} either, ${n('neither')} neither)`);
    if (m.verdict === 'review') for (const o of m.objects.filter((o) => o.matches !== 'applied')) console.log(`           ${o.matches.padEnd(11)} ${o.key}`);
  }
  if (r.verdict !== 'consistent') {
    console.log('\nNo single state matches. Nearest states and their differing material objects:');
    for (const n of r.nearest) {
      console.log(`\n  main + [${n.applied.join(', ') || 'none'}]: ${n.differing} differing`);
      for (const d of n.diffs) console.log(`    ${d.key}\n      expected:   ${String(d.expected).replace(/\n/g, '\n                  ')}\n      production: ${String(d.production).replace(/\n/g, '\n                  ')}`);
    }
    console.log('\nSTOP: do not build or load a baseline. A person must explain every difference first.');
  }
  console.log(`\nThis compares ${Object.keys(COVERAGE).length} catalog categories only. It does not cover: ${NOT_COVERED.slice(0, 4).join('; ')}; see baseline/README.md.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const files = args.filter((a, i) => !a.startsWith('--') && !['--main', '--stack', '--json'].includes(args[i - 1]));
  if (!files.length) { console.error('usage: detect-stack.mjs <export.json> [<part2.json> ...] [--main ref] [--stack ref] [--json out]'); process.exit(2); }
  let prod;
  try { prod = readExport(...files); } catch (e) { console.error(e.message); process.exit(4); }
  const info = await stackStates({ mainRef: opt('--main') ?? 'origin/main', stackRef: opt('--stack') ?? 'origin/stack/14-photo-records-owner-check' });
  const r = classify(prod, info);
  print(r, info, prod);
  if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify({ main: info.main, stack: info.stack, ...r }, null, 2));
  process.exit(r.verdict === 'consistent' ? 0 : 1);
}
