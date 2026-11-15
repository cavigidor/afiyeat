// Every schema state production could be in with respect to the pending integration-stack migrations:
// main's baseline plus each SUBSET of the pending files, applied in timestamp order, built in-process.
// "Material" objects are the fingerprint rows whose definition differs between any two of these states:
// exactly the objects the stack creates, changes or removes - found by building, not by reading names.
import { buildDatabase, pendingFiles, applyInProcess, resolveRef } from './migrations.mjs';
import { fingerprintOf } from '../baseline/fingerprint.mjs';
import { validateExport } from './fingerprint-file.mjs';

export async function stackStates({ mainRef = 'origin/main', stackRef }) {
  const main = resolveRef(mainRef), stack = resolveRef(stackRef);
  const pending = pendingFiles({ ref: stack, mainRef: main });
  const base = await buildDatabase({ mainRef: main });
  const states = [];
  try {
    for (let mask = 0; mask < 1 << pending.length; mask++) {
      const applied = pending.filter((_, i) => mask & (1 << i));
      const db = await base.clone();
      try {
        let error = null;
        for (const f of applied) { try { await applyInProcess(db, f.name, f.sql); } catch (e) { error = e.message; break; } }
        const fp = error ? null : validateExport(await fingerprintOf(db), `state main+[${applied.map((f) => f.name.slice(0, 14)).join(',')}]`);
        states.push({ mask, applied: applied.map((f) => f.name), error, fp });
      } finally { await db.close(); }
    }
  } finally { await base.close(); }
  return { main, stack, pending: pending.map((f) => f.name), states };
}

/** Keys ("category\tkey") whose hash is not the same in every buildable state. */
export function materialKeys(states) {
  const ok = states.filter((s) => s.fp);
  const all = new Set(ok.flatMap((s) => [...s.fp.map.keys()]));
  return [...all].filter((k) => new Set(ok.map((s) => s.fp.map.get(k)?.h ?? 'ABSENT')).size > 1).sort();
}

/** Keys that migration i changes: differ between a state without i and the same state with i. */
export function keysTouchedBy(states, i) {
  const byMask = new Map(states.filter((s) => s.fp).map((s) => [s.mask, s]));
  const touched = new Set();
  for (const s of byMask.values()) {
    if (s.mask & (1 << i)) continue;
    const t = byMask.get(s.mask | (1 << i));
    if (!t) continue;
    for (const k of new Set([...s.fp.map.keys(), ...t.fp.map.keys()])) if ((s.fp.map.get(k)?.h ?? 'ABSENT') !== (t.fp.map.get(k)?.h ?? 'ABSENT')) touched.add(k);
  }
  return [...touched].sort();
}
