import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setPerfEnabledForTests, clearPerf, perfEnabled, perfEntries, percentile, startSpan, summary } from '@/lib/perf';

afterEach(() => { __setPerfEnabledForTests(null); clearPerf(); vi.restoreAllMocks(); localStorage.clear(); });

describe('perf instrumentation (E0-c draft)', () => {
  it('is off by default and records nothing when off', () => {
    expect(perfEnabled()).toBe(false);
    startSpan('save_confirmed', 'custom')();
    expect(perfEntries()).toHaveLength(0);
  });

  it('turns on only with the explicit device flag', () => {
    localStorage.setItem('afiyeat.perf', 'true');
    expect(perfEnabled()).toBe(false);
    localStorage.setItem('afiyeat.perf', '1');
    expect(perfEnabled()).toBe(true);
  });

  it('treats a throwing storage as off', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(perfEnabled()).toBe(false);
  });

  it('records duration once, first span cold then warm, per metric and kind', () => {
    __setPerfEnabledForTests(true);
    let t = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const a = startSpan('add_sheet_ready'); t += 120; a(); a();
    const b = startSpan('add_sheet_ready'); t += 80; b();
    const c = startSpan('list_content', 'custom'); t += 400; c();
    const e = perfEntries();
    expect(e.map((x) => [x.metric, x.start, x.ms])).toEqual([
      ['add_sheet_ready', 'cold', 120], ['add_sheet_ready', 'warm', 80], ['list_content', 'cold', 400],
    ]);
  });

  it('stores only metric, timing, cold/warm, outcome and list kind', () => {
    __setPerfEnabledForTests(true);
    startSpan('save_confirmed', 'restaurants')('duplicate');
    expect(Object.keys(perfEntries()[0]).sort()).toEqual(['at', 'kind', 'metric', 'ms', 'outcome', 'start']);
  });

  it('summarises successful runs only, failures counted apart', () => {
    __setPerfEnabledForTests(true);
    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    for (const ms of [100, 200, 300, 400, 500]) { const end = startSpan('save_confirmed', 'custom'); t += ms; end(); }
    const err = startSpan('save_confirmed', 'custom'); t += 9000; err('error');
    const s = summary();
    const warm = s.rows.find((r) => r.start === 'warm')!;
    expect(warm).toMatchObject({ metric: 'save_confirmed', n: 4, median: 300, p95: 500, max: 500 });
    expect(s.notOk).toEqual({ 'save_confirmed:error': 1 });
  });

  it('nearest-rank percentiles', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 95)).toBe(19);
    expect(percentile([3, 1, 2], 50)).toBe(2);
  });

  it('keeps at most 500 entries', () => {
    __setPerfEnabledForTests(true);
    for (let i = 0; i < 520; i++) startSpan('list_content', 'restaurants')();
    expect(perfEntries()).toHaveLength(500);
  });
});
