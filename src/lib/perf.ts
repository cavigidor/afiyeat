// E0-c performance instrumentation (DRAFT). Measures three moments of the Lists V2 targets:
//   add_sheet_ready  Add sheet opened -> destinations and statuses loaded and the sheet painted
//   list_content     list screen opened -> its items painted
//   save_confirmed   Save tapped -> the backend's answer handled
//
// Off by default, in every build. Turned on per device for a measurement session only:
//   Safari Web Inspector console on the device:  localStorage.setItem('afiyeat.perf', '1'); location.reload()
//   or a build made with VITE_PERF=1.
// When off, every function returns immediately and nothing is stored.
// When on, entries stay in memory on the device (no network, no storage, nothing sent anywhere) and hold
// only: metric name, milliseconds, cold/warm, outcome, and the list kind - never names, notes, ids or places.
// Read them in the same console: __afiyeatPerf.summary() / __afiyeatPerf.export() / __afiyeatPerf.clear().
//
// These are measurement tools, not results. No number from them is a baseline until it comes from the
// physical-device protocol (iOS 15 gate phone and a current iPhone, isolated backend, recorded runs).

export type PerfMetric = 'add_sheet_ready' | 'list_content' | 'save_confirmed';
export type PerfOutcome = 'ok' | 'duplicate' | 'error' | 'abandoned';
export type ListKind = 'restaurants' | 'custom' | 'shared';

export interface PerfEntry {
  metric: PerfMetric;
  ms: number;
  start: 'cold' | 'warm';
  outcome: PerfOutcome;
  kind?: ListKind;
  at: number; // performance.now() at the end, for ordering within a session
}

const MAX_ENTRIES = 500;
const entries: PerfEntry[] = [];
const seen = new Set<string>();
let forced: boolean | null = null;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function perfEnabled(): boolean {
  if (forced !== null) return forced;
  // Inlined by Vite at build time: a normal build contains the constant false here.
  if (import.meta.env.VITE_PERF === '1') return true;
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('afiyeat.perf') === '1';
  } catch {
    return false; // storage can throw (private mode, blocked): treat as off
  }
}

/** Tests only. */
export function __setPerfEnabledForTests(value: boolean | null) { forced = value; }

/**
 * Start a measurement. Returns end(). Calling end() more than once records once.
 * The first span of a metric (per metric and kind) in this app session is "cold"; later ones are "warm".
 */
export function startSpan(metric: PerfMetric, kind?: ListKind): (outcome?: PerfOutcome) => void {
  if (!perfEnabled()) return () => {};
  const t0 = now();
  const key = `${metric}:${kind ?? ''}`;
  const start: 'cold' | 'warm' = seen.has(key) ? 'warm' : 'cold';
  seen.add(key);
  let done = false;
  return (outcome: PerfOutcome = 'ok') => {
    if (done) return;
    done = true;
    record({ metric, ms: Math.round((now() - t0) * 10) / 10, start, outcome, kind, at: now() });
  };
}

/** End after the next paint, so "ready" means visible, not merely computed. */
export function endAfterPaint(end: (outcome?: PerfOutcome) => void, outcome: PerfOutcome = 'ok') {
  if (typeof requestAnimationFrame === 'undefined') { end(outcome); return; }
  requestAnimationFrame(() => requestAnimationFrame(() => end(outcome)));
}

function record(e: PerfEntry) {
  entries.push(e);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export function perfEntries(): readonly PerfEntry[] { return entries; }
export function clearPerf() { entries.length = 0; seen.clear(); }

/** Nearest-rank percentile. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * s.length);
  return s[Math.min(s.length, Math.max(1, rank)) - 1];
}

export interface PerfSummaryRow { metric: PerfMetric; start: 'cold' | 'warm'; kind: string; n: number; median: number | null; p95: number | null; max: number | null }

/** Successful runs only, grouped by metric, cold/warm and list kind. Failures are counted separately. */
export function summary(): { rows: PerfSummaryRow[]; notOk: Record<string, number> } {
  const groups = new Map<string, PerfEntry[]>();
  const notOk: Record<string, number> = {};
  for (const e of entries) {
    if (e.outcome !== 'ok') { notOk[`${e.metric}:${e.outcome}`] = (notOk[`${e.metric}:${e.outcome}`] ?? 0) + 1; continue; }
    const k = `${e.metric}|${e.start}|${e.kind ?? ''}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const rows = [...groups.entries()].map(([k, list]) => {
    const [metric, start, kind] = k.split('|') as [PerfMetric, 'cold' | 'warm', string];
    const ms = list.map((e) => e.ms);
    return { metric, start, kind, n: ms.length, median: percentile(ms, 50), p95: percentile(ms, 95), max: Math.max(...ms) };
  }).sort((a, b) => `${a.metric}${a.start}${a.kind}`.localeCompare(`${b.metric}${b.start}${b.kind}`));
  return { rows, notOk };
}

if (typeof window !== 'undefined' && perfEnabled()) {
  (window as unknown as { __afiyeatPerf: unknown }).__afiyeatPerf = {
    summary: () => { const s = summary(); console.table(s.rows); return s; },
    export: () => JSON.stringify({ userAgent: navigator.userAgent, entries }, null, 2),
    clear: clearPerf,
  };
}
