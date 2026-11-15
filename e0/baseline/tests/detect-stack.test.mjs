// Migration detection and export validation. In-process only.
//   node --test baseline/tests/detect-stack.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDatabase } from '../../lib/migrations.mjs';
import { stackStates } from '../../lib/stack-states.mjs';
import { validateExport, parseExportText, InvalidExport, mergeParts } from '../../lib/fingerprint-file.mjs';
import { fingerprintOf, exportSql } from '../fingerprint.mjs';
import { classify } from '../detect-stack.mjs';

const STACK = process.env.E0_STACK_REF ?? 'origin/stack/14-photo-records-owner-check';
const OLD_SIGNATURES = readFileSync(new URL('../stack-signatures.withdrawn.sql', import.meta.url), 'utf8');
let info, full, mainOnly;
const N14 = '20261111120000_photo_records_owner_check.sql';

/** A "production" export: main + the given stack files, then optional SQL tampering. */
async function exportOf({ include, tamper = '' }) {
  const db = await buildDatabase({ stackRef: STACK, include });
  try {
    if (tamper) await db.exec(tamper);
    const old = (await db.query(OLD_SIGNATURES.replace(/^--.*$/gm, ''))).rows;
    const fp = validateExport(await fingerprintOf(db), 'test export');
    return { fp, old: Object.fromEntries(old.map((r) => [r.pr, r.in_production])) };
  } finally { await db.close(); }
}
const verdicts = (r) => Object.fromEntries(r.perMigration.map((m) => [m.migration.slice(15), m.verdict]));

before(async () => {
  info = await stackStates({ stackRef: STACK });
  full = info.pending;
  mainOnly = await exportOf({ include: [] });
});

test('D0 all 32 states build; the material set includes effective policies of every touched table', () => {
  assert.equal(info.states.length, 32);
  assert.deepEqual(info.states.filter((s) => s.error).map((s) => s.applied), []);
  assert.match(info.main, /^[0-9a-f]{40}$/); assert.match(info.stack, /^[0-9a-f]{40}$/);
});

test('D1 main only: every pending migration is absent', async () => {
  const r = classify(mainOnly.fp, info);
  assert.equal(r.verdict, 'consistent');
  assert.ok(Object.values(verdicts(r)).every((v) => v === 'absent'), JSON.stringify(verdicts(r)));
});

test('D2 everything applied: every pending migration is present', async () => {
  const r = classify((await exportOf({ include: full })).fp, info);
  assert.equal(r.verdict, 'consistent');
  assert.ok(Object.values(verdicts(r)).every((v) => v === 'present'), JSON.stringify(verdicts(r)));
});

test('D3 a partial stack (#7, #8 only) is identified exactly', async () => {
  const r = classify((await exportOf({ include: full.slice(0, 2) })).fp, info);
  assert.deepEqual(r.matching_state, full.slice(0, 2));
  assert.deepEqual(Object.values(verdicts(r)), ['present', 'present', 'absent', 'absent', 'absent']);
});

test('D4 (PM case) #14 applied but its restaurant ownership INSERT policy reverted: #14 is NOT present', async () => {
  const revert = `
    DROP POLICY "Users can insert their own images" ON public.restaurant_images;
    CREATE POLICY "Users can insert their own images" ON public.restaurant_images FOR INSERT
      WITH CHECK (auth.uid() = user_id);`; // main's definition: roles {public}
  const x = await exportOf({ include: full, tamper: revert });
  // The reverted policy is exactly main's definition, so the tampering is a true reversion.
  const k = 'policy\tpublic.restaurant_images.Users can insert their own images';
  assert.equal(x.fp.map.get(k).h, mainOnly.fp.map.get(k).h, 'reverted to the pre-#14 definition');
  assert.equal(x.old['#14'], 'present', 'the withdrawn substring check is fooled (the reported defect)');
  const r = classify(x.fp, info);
  assert.equal(r.verdict, 'no-matching-state');
  assert.equal(verdicts(r)[N14.slice(15)], 'review');
  const m = r.perMigration.find((p) => p.migration === N14);
  assert.ok(m.objects.some((o) => o.key.includes('restaurant_images') && o.matches === 'not-applied'), JSON.stringify(m.objects));
  assert.ok(Object.values(verdicts(r)).every((v) => v === 'review'), 'nothing is called present or absent without a full match');
});

test('D5 a policy that merely mentions the right words is not accepted as #7\'s ownership check', async () => {
  const spoof = `
    DROP POLICY IF EXISTS "Users can insert their own list items" ON public.custom_list_items;
    DO $$ DECLARE p text; BEGIN
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='custom_list_items' AND cmd='INSERT' LOOP
        EXECUTE format('DROP POLICY %I ON public.custom_list_items', p); END LOOP; END $$;
    CREATE POLICY "Users can insert their own list items" ON public.custom_list_items FOR INSERT TO authenticated
      WITH CHECK (auth.uid() IS NOT NULL OR 'custom_lists' IS NOT NULL);`;
  const x = await exportOf({ include: full, tamper: spoof });
  assert.equal(x.old['#7'], 'present', 'the withdrawn substring check is fooled');
  const r = classify(x.fp, info);
  assert.equal(r.verdict, 'no-matching-state');
  assert.equal(verdicts(r)['custom_list_items_owner_check.sql'], 'review');
});

test('D6 an extra permissive policy under a new name, on a touched table, is detected through the effective policy', async () => {
  const extra = `CREATE POLICY "zz allow all inserts" ON public.restaurant_images FOR INSERT TO authenticated WITH CHECK (true);`;
  const x = await exportOf({ include: full, tamper: extra });
  assert.equal(x.old['#14'], 'present');
  const r = classify(x.fp, info);
  assert.equal(r.verdict, 'no-matching-state');
  assert.ok(r.nearest[0].diffs.some((d) => d.key === 'effective_policy public.restaurant_images.INSERT'), JSON.stringify(r.nearest[0].diffs.map((d) => d.key)));
});

test('D7 a function grant change on a touched function is detected', async () => {
  const x = await exportOf({ include: full, tamper: `GRANT EXECUTE ON FUNCTION public.can_view_custom_list(uuid, uuid) TO anon;` });
  const r = classify(x.fp, info);
  assert.equal(r.verdict, 'no-matching-state');
});

// ---------------------------------------------------------------- export validation
const good = () => JSON.parse(JSON.stringify({ ...mainOnly.fp, map: undefined, counts: undefined }, (k, v) => (k === 'map' || k === 'counts' ? undefined : v)));
const rejected = (fp, pattern) => {
  let err; try { validateExport(fp); } catch (e) { err = e; }
  assert.ok(err instanceof InvalidExport, 'expected the export to be rejected');
  assert.match(err.message, pattern);
};

test('V1 a valid export round-trips through every accepted copy form', () => {
  const g = good(); const text = JSON.stringify(g);
  for (const form of [text, JSON.stringify(text), JSON.stringify([{ fingerprint: text }])]) validateExport(parseExportText(form));
});
test('V2 truncated copy, missing field, unknown field, wrong version or format are rejected', () => {
  assert.throws(() => parseExportText(JSON.stringify(good()).slice(0, 5000)), InvalidExport);
  const a = good(); delete a.checksum; rejected(a, /missing field "checksum"/);
  const b = good(); b.extra = 1; rejected(b, /unexpected field/);
  const c = good(); c.version = 1; rejected(c, /version/);
  const d = good(); d.format = 'other'; rejected(d, /format/);
});
test('V3 a removed row, a duplicated row or reordered rows are rejected', () => {
  const a = good(); a.rows.splice(10, 1); rejected(a, /row_count|checksum/);
  const b = good(); b.rows.splice(10, 1); b.row_count--; rejected(b, /checksum/);
  const c = good(); c.rows.splice(11, 0, c.rows[10]); c.row_count++; rejected(c, /duplicate/);
  const d = good(); [d.rows[3], d.rows[4]] = [d.rows[4], d.rows[3]]; rejected(d, /out of order/);
});
test('V4 an edited definition, a malformed hash or a missing definition are rejected', () => {
  const a = good(); const i = a.rows.findIndex((r) => r.c === 'policy'); a.rows[i].d = a.rows[i].d.replace('auth.uid()', 'true'); rejected(a, /does not match its hash/);
  const b = good(); b.rows[0].h = 'xyz'; rejected(b, /32 hex/);
  const c = good(); const j = c.rows.findIndex((r) => r.c === 'policy'); c.rows[j].d = null; rejected(c, /full definition missing/);
  const d = good(); const f = d.rows.findIndex((r) => r.c === 'function'); d.rows[f].d = 'x'; rejected(d, /hash-only/);
});
test('V5 an export that saw no policies (e.g. run as a restricted role) is rejected, even with a consistent checksum', async () => {
  const a = good(); a.rows = a.rows.filter((r) => r.c !== 'policy' && r.c !== 'effective_policy'); a.row_count = a.rows.length;
  const { createHash } = await import('node:crypto');
  a.checksum = createHash('md5').update(a.rows.map((r) => `${r.c}\t${r.k}\t${r.h}`).join('\n')).digest('hex');
  rejected(a, /no policy rows/);
});
test('V6 coverage must be exactly the documented list', () => {
  const a = good(); a.coverage = a.coverage.filter((c) => c !== 'publication_table'); rejected(a, /coverage lacks "publication_table"/);
  const b = good(); b.coverage.push('secrets'); rejected(b, /unknown category/);
});

test('V7 a split export merges back to exactly the whole; a missing, foreign or repeated part is rejected', async () => {
  const db = await buildDatabase({ stackRef: STACK, include: [] });
  try {
    const part = async (i, n) => JSON.parse((await db.query(exportSql({ part: i, parts: n }))).rows[0].fingerprint);
    const parts = [await part(1, 3), await part(2, 3), await part(3, 3)];
    const merged = validateExport(mergeParts(parts));
    assert.equal(merged.checksum, mainOnly.fp.checksum);
    assert.equal(merged.row_count, mainOnly.fp.row_count);
    assert.throws(() => validateExport(mergeParts([parts[0], parts[2]])), /expected 3 parts|part 2 is missing/);
    assert.throws(() => validateExport(mergeParts([parts[0], parts[1], parts[1]])), /part 3 is missing/);
    const foreign = { ...parts[2], checksum: '0'.repeat(32) };
    assert.throws(() => validateExport(mergeParts([parts[0], parts[1], foreign])), /disagree on checksum/);
    assert.throws(() => validateExport(parts[0]), /part 1 of 3/);
  } finally { await db.close(); }
});
