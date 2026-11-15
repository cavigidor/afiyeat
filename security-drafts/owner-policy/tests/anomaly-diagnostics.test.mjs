// O-S1: the diagnostics count anomalies correctly, read only, and the fix leaves every anomaly in place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDatabase } from '../harness/migrations.mjs';

const DIAG = readFileSync(new URL('../anomaly-diagnostics.sql', import.meta.url), 'utf8');
const FIX = readFileSync(new URL('../fix.sql', import.meta.url), 'utf8');
const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b';
const LA = '10000000-0000-4000-8000-000000000001';

test('diagnostics: counts only, correct, read-only; fix.sql keeps every anomaly', async () => {
  const db = await buildDatabase({});
  try {
    const q = async (sql, p) => (await db.query(sql, p)).rows;
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${A}', 'a@example.test'), ('${B}', 'b@example.test');
      INSERT INTO public.profiles (user_id, username) VALUES ('${A}', 'a'), ('${B}', 'b') ON CONFLICT DO NOTHING;
      INSERT INTO public.custom_lists (id, user_id, name) VALUES ('${LA}', '${A}', 'Wines');
      INSERT INTO public.custom_list_statuses (id, list_id, user_id, name) VALUES
        ('20000000-0000-4000-8000-000000000001', '${LA}', '${A}', 'Mine'),
        ('20000000-0000-4000-8000-000000000002', '${LA}', '${B}', 'Foreign used'),
        ('20000000-0000-4000-8000-000000000003', '${LA}', '${B}', 'Foreign unused');
      INSERT INTO public.custom_list_types (id, list_id, user_id, name) VALUES ('30000000-0000-4000-8000-000000000001', '${LA}', '${B}', 'Foreign type');
      INSERT INTO public.custom_list_items (list_id, user_id, name, status_id, type_ids) VALUES
        ('${LA}', '${A}', 'Rioja', '20000000-0000-4000-8000-000000000002', ARRAY['30000000-0000-4000-8000-000000000001']::uuid[]);`);
    const run = async () => { await db.exec('BEGIN READ ONLY'); try { return await q(DIAG.replace(/^--.*$/gm, '')); } finally { await db.exec('ROLLBACK'); } };
    const r = await run();
    const by = Object.fromEntries(r.map((x) => [x.table_name, x]));
    assert.equal(Number(by.custom_list_statuses.anomalous_rows), 2);
    assert.equal(Number(by.custom_list_statuses.rows_referenced_by_items), 1);
    assert.equal(Number(by.custom_list_statuses.rows_used_by_the_list_owner), 1);
    assert.equal(Number(by.custom_list_types.anomalous_rows), 1);
    assert.equal(Number(by.custom_list_types.rows_used_by_the_list_owner), 1);
    const text = JSON.stringify(r);
    for (const leak of [A, B, LA, 'Foreign', 'Wines', 'example.test']) assert.ok(!text.includes(leak), `result must not contain ${leak}`);
    const before = await q(`SELECT id, list_id, user_id, name FROM custom_list_statuses UNION ALL SELECT id, list_id, user_id, name FROM custom_list_types ORDER BY 1`);
    await db.exec(FIX);
    assert.deepEqual(await q(`SELECT id, list_id, user_id, name FROM custom_list_statuses UNION ALL SELECT id, list_id, user_id, name FROM custom_list_types ORDER BY 1`), before, 'fix deletes and reassigns nothing');
    assert.deepEqual(await run(), r, 'same counts after the fix');
    assert.equal((await q(`SELECT status_id FROM custom_list_items`))[0].status_id, '20000000-0000-4000-8000-000000000002', 'the owner\'s item still shows its status');
  } finally { await db.close(); }
});
