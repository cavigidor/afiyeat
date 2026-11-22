// @vitest-environment node
//
// Preset item fields (db/proposals/lists_v2_owner_fields.sql) on a database that holds every migration in
// the repository - production's schema today, policies included. In-process Postgres only.
//
// People: OWNER (public profile), FOLLOWER (accepted follower who can see OWNER's lists today),
// STRANGER (signed in), and signed-out visitors.
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { replayMigrations } from './fixtures/replayMigrations';
import { fieldsForPreset, PRESET_FIELDS } from '@/lib/presetFields';
import { MORE_PRESETS, V2_PRESETS } from '@/lib/listPresets';

const SQL = readFileSync(new URL('../db/proposals/lists_v2_owner_fields.sql', import.meta.url), 'utf8');
const proposal = (f: string) => readFileSync(new URL(`../db/proposals/${f}`, import.meta.url), 'utf8');
const ROLLBACK = proposal('lists_v2_owner_fields_rollback.sql');
const PRECHECK = proposal('lists_v2_owner_fields_precheck.sql');
const POSTCHECK = proposal('lists_v2_owner_fields_postcheck.sql');
const PARK = proposal('lists_v2_owner_fields_park.sql');
const UNPARK = proposal('lists_v2_owner_fields_unpark.sql');

const id = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = id(1), FOLLOWER = id(2), STRANGER = id(3);
const L_BEANS = id(21), L_WINES = id(22), L_ANON = id(23), L_THEIRS = id(24);
const I_HALO = id(31), I_PERU = id(32), I_RIOJA = id(33), I_ANON = id(34), I_THEIRS = id(35);
const NEW_TABLES = ['custom_list_owner_settings', 'custom_list_item_owner_values'];
const EXISTING = ['custom_lists', 'custom_list_items', 'custom_list_statuses', 'custom_list_types', 'custom_list_item_images',
  'shared_lists', 'shared_list_items', 'restaurants', 'profiles'];

const BEANS_FIELDS = [
  { key: 'c_roaster', label: 'Roaster', type: 'text' },
  { key: 'c_roast', label: 'Roast', type: 'choice', options: ['Light', 'Light-Medium', 'Medium', 'Medium-Dark', 'Dark', 'Extra Dark'] },
  { key: 'c_best_for', label: 'Best for', type: 'multi', options: ['Espresso', 'Pour-over', 'Cold Brew', 'Other'] },
  { key: 'c_taste', label: 'Taste profile', type: 'tags' },
  { key: 'c_altitude', label: 'Altitude (m)', type: 'number' },
  { key: 'c_roast_date', label: 'Roast date', type: 'date' },
];
const SECRET = 'Tide Roasters (private)';

let db: PGlite;
// How Lovable's migration tool runs the file (drizzle-orm's migrator): begin, the whole file as one query,
// commit; any error rolls the whole run back. scripts/lab/owner-fields-drizzle.mjs checks the real runner.
const applyLikeRunner = (d: PGlite, sql: string) => d.transaction(async (tx) => { await tx.exec(sql); });
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
async function as<T>(uid: string | null, fn: () => Promise<T>): Promise<T> {
  if (uid) await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  else await db.exec(`SET ROLE anon; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', 'anon', false);`);
  try { return await fn(); } finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', '', false);`); }
}
const refused = async (p: Promise<unknown>, pattern?: RegExp) => {
  let err: unknown = null;
  try { await p; } catch (e) { err = e; }
  expect(err, 'expected the statement to be refused').toBeTruthy();
  if (pattern) expect(`${(err as Error).message} ${(err as { code?: string }).code ?? ''}`).toMatch(pattern);
};
const readAs = (uid: string | null, sql: string, p: unknown[] = []) => as(uid, () => q(sql, p)).catch(() => 'refused' as const);
const setFields = (who: string, list: string, fields: unknown) => as(who, () => q(
  `INSERT INTO custom_list_owner_settings (list_id, user_id, fields) VALUES ($1, $2, $3)
   ON CONFLICT (list_id) DO UPDATE SET fields = EXCLUDED.fields`, [list, who, JSON.stringify(fields)]));
const setValues = (who: string, item: string, list: string, values: unknown) => as(who, () => q(
  `INSERT INTO custom_list_item_owner_values (item_id, list_id, user_id, "values") VALUES ($1, $2, $3, $4)
   ON CONFLICT (item_id) DO UPDATE SET "values" = EXCLUDED."values"`, [item, list, who, JSON.stringify(values)]));
const valuesOf = async (item: string) => (await q<{ values: Record<string, unknown> }>(`SELECT "values" FROM custom_list_item_owner_values WHERE item_id = $1`, [item]))[0]?.values;
const shape = () => q(`SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY table_name, column_name`, [EXISTING]);
const policies = () => q(`SELECT tablename, policyname, cmd, roles::text, qual, with_check FROM pg_policies
  WHERE schemaname IN ('public', 'storage') AND NOT (tablename = ANY($1)) ORDER BY 1, 2`, [NEW_TABLES]);
const functions = () => q(`SELECT p.oid::regprocedure::text AS f, md5(pg_get_functiondef(p.oid)) AS d FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname NOT LIKE 'lv2\\_%' AND p.proname NOT IN
  ('count_custom_list_field_values', 'delete_custom_list_field', 'export_my_list_owner_data') AND p.prokind = 'f' ORDER BY 1`);
const items = () => q(`SELECT * FROM custom_list_items ORDER BY id`);

let before: { shape: unknown; policies: unknown; functions: unknown };
let precheck: { check_name: string; ok: boolean }[] = [];
let postcheck: { check_name: string; ok: boolean }[] = [];

beforeAll(async () => {
  db = await replayMigrations();
  for (const u of [OWNER, FOLLOWER, STRANGER]) {
    await q(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [u, `${u}@example.test`]);
    if ((await q(`SELECT 1 FROM public.profiles WHERE user_id = $1`, [u])).length === 0) {
      await q(`INSERT INTO public.profiles (user_id, username) VALUES ($1, $2)`, [u, `u${u.slice(-2)}`]);
    }
  }
  await q(`UPDATE public.profiles SET is_private = false`);
  await q(`INSERT INTO public.follows (follower_id, following_id, status) VALUES ($1, $2, 'accepted')`, [FOLLOWER, OWNER]);
  await q(`INSERT INTO public.custom_lists (id, user_id, name, icon, visibility) VALUES
    ($1, $5, 'Coffee Beans', '🫘', 'profile'), ($2, $5, 'Wines', '🍷', 'profile'),
    ($3, $5, 'Secret beans', '🫘', 'anonymous'), ($4, $6, 'Their beans', '🫘', 'profile')`,
  [L_BEANS, L_WINES, L_ANON, L_THEIRS, OWNER, STRANGER]);
  await q(`INSERT INTO public.custom_list_items (id, list_id, user_id, name, notes, rating) VALUES
    ($1, $2, $3, 'Halo Beriti', 'Bright and floral', 9), ($4, $2, $3, 'Peru Cajamarca', NULL, NULL),
    ($5, $6, $3, 'Rioja Reserva', 'Dinner with Sam', 8), ($7, $8, $3, 'Anon bean', NULL, NULL),
    ($9, $10, $11, 'Their bean', NULL, NULL)`,
  [I_HALO, L_BEANS, OWNER, I_PERU, I_RIOJA, L_WINES, I_ANON, L_ANON, I_THEIRS, L_THEIRS, STRANGER]);
  before = { shape: await shape(), policies: await policies(), functions: await functions() };
  precheck = await q(PRECHECK);
  await applyLikeRunner(db, SQL);
  postcheck = await q(POSTCHECK);
}, 120_000);

afterAll(async () => { await db?.close(); });

describe('the production plan\'s read-only checks', () => {
  it('every precheck passes on today\'s schema, before applying', () => {
    expect(precheck.length).toBe(6);
    for (const c of precheck) expect(c.ok, c.check_name).toBe(true);
  });
  it('every postcheck passes right after applying, including the exact-text digest', () => {
    expect(postcheck.length).toBe(9);
    for (const c of postcheck) expect(c.ok, c.check_name).toBe(true);
  });
  it('the exact-text check catches a copy whose line breaks were changed in transit', async () => {
    const other = await replayMigrations();
    try {
      await applyLikeRunner(other, SQL.replace(/\n/g, '\n\n'));
      const r = (await other.query<{ check_name: string; ok: boolean }>(POSTCHECK)).rows;
      expect(r.find((c) => c.check_name.startsWith('applied exactly'))?.ok).toBe(false);
    } finally { await other.close(); }
  }, 60_000);
});

// Top-level statements of the file, split where a line ends a statement outside a $$ body.
function statements(sql: string) {
  const out: string[] = [];
  let cur: string[] = [];
  let inBody = false;
  for (const line of sql.split('\n')) {
    cur.push(line);
    if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inBody = !inBody;
    if (!inBody && !line.startsWith('--') && line.trimEnd().endsWith(';')) { out.push(cur.join('\n')); cur = []; }
  }
  out.push(cur.join('\n'));
  return out;
}

describe('one transaction, supplied by the runner (third candidate, 2026-11-21)', () => {
  const NEW_FUNCTIONS = `SELECT p.oid::regprocedure::text AS f FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    AND (p.proname LIKE 'lv2\\_%' OR p.proname IN ('count_custom_list_field_values', 'delete_custom_list_field', 'export_my_list_owner_data'))`;
  const leftovers = async (d: PGlite) => ({
    tables: (await d.query(`SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1)`, [NEW_TABLES])).rows,
    functions: (await d.query(NEW_FUNCTIONS)).rows,
    policies: (await d.query(`SELECT policyname FROM pg_policies WHERE tablename = ANY($1)`, [NEW_TABLES])).rows,
    triggers: (await d.query(`SELECT tgname FROM pg_trigger WHERE tgname IN ('lv2_check_owner_values', 'lv2_guard_field_removal')`)).rows,
  });
  const nothing = { tables: [], functions: [], policies: [], triggers: [] };
  const code = (x: string) => x.split('\n').filter((l) => l.trim() && !l.startsWith('--')).join('\n');

  it('has no transaction-control statements, and the grants follow the tables and precede row-level security', () => {
    const s = statements(SQL).map(code).filter(Boolean);
    expect(s.filter((x) => /^(BEGIN|COMMIT|ROLLBACK|START TRANSACTION|END|SAVEPOINT|RELEASE)\b[^;]*;$/i.test(x))).toEqual([]);
    expect(s).toHaveLength(35);
    const at = (p: string) => s.findIndex((x) => x.startsWith(p));
    const lastTable = Math.max(...s.map((x, i) => (/^CREATE (TABLE|INDEX)/.test(x) ? i : -1)));
    expect(at('REVOKE ALL ON public.custom_list_owner_settings')).toBe(lastTable + 1);
    expect(at('GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_list_owner_settings')).toBe(lastTable + 2);
    expect(at('GRANT SELECT, INSERT, UPDATE, DELETE')).toBeLessThan(at('ALTER TABLE'));
    expect(at('GRANT SELECT, INSERT, UPDATE, DELETE')).toBeLessThan(at('CREATE POLICY'));
    expect(SQL).not.toMatch(/Do not paste into Lovable|NOT a migration/);
  });

  it('a failure after any statement (right after the table grants included) leaves nothing behind', async () => {
    const fresh = await replayMigrations();
    try {
      expect(await leftovers(fresh)).toEqual(nothing);
      const parts = statements(SQL);
      const body = parts.filter((p) => code(p)).length;
      expect(body).toBe(35);
      for (let cut = 1; cut <= body; cut++) {
        const broken = [...parts.slice(0, cut), 'SELECT 1/0; -- injected failure', ...parts.slice(cut)].join('\n');
        await refused(applyLikeRunner(fresh, broken), /division by zero/);
        expect(await leftovers(fresh), `after statement ${cut}`).toEqual(nothing);
      }
      const pre = (await fresh.query<{ ok: boolean }>(PRECHECK)).rows;
      expect(pre.map((c) => c.ok)).toEqual([true, true, true, true, true, true]);
      await applyLikeRunner(fresh, SQL); // and the real file still applies cleanly afterwards
      for (const c of (await fresh.query<{ check_name: string; ok: boolean }>(POSTCHECK)).rows) expect(c.ok, c.check_name).toBe(true);
    } finally { await fresh.close(); }
  }, 120_000);

  it('a real statement error (not an injected one) also rolls back everything before it', async () => {
    const fresh = await replayMigrations();
    try {
      // The privileges block names a role that does not exist: it fails after both tables were created.
      const broken = SQL.replace('TO authenticated;\n-- Not added to supabase_realtime', 'TO no_such_role;\n-- Not added to supabase_realtime');
      expect(broken).not.toBe(SQL);
      await refused(applyLikeRunner(fresh, broken), /no_such_role/);
      expect(await leftovers(fresh)).toEqual(nothing);
    } finally { await fresh.close(); }
  }, 60_000);

  it('control: with a COMMIT embedded after the grants, a later failure does leave objects behind', async () => {
    const fresh = await replayMigrations();
    try {
      const parts = statements(SQL);
      const grants = parts.findIndex((p) => p.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_list_owner_settings'));
      const broken = [...parts.slice(0, grants + 1), 'COMMIT;', 'SELECT 1/0;', ...parts.slice(grants + 1)].join('\n');
      await refused(fresh.exec(`BEGIN; ${broken}`));
      await fresh.exec('ROLLBACK').catch(() => {});
      expect((await leftovers(fresh)).tables.length).toBe(2); // why the runner refuses transaction statements
    } finally { await fresh.close(); }
  }, 60_000);
});


describe('applying it', () => {
  it('creates the two tables and nothing for brews or layout, and can run a second time', async () => {
    await applyLikeRunner(db, SQL);
    for (const t of NEW_TABLES) expect((await q<{ r: string }>(`SELECT to_regclass($1)::text AS r`, [`public.${t}`]))[0].r).toBe(t);
    expect((await q<{ r: string | null }>(`SELECT to_regclass('public.custom_list_item_brews')::text AS r`))[0].r).toBeNull();
    const cols = await q<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'custom_list_owner_settings'`);
    expect(cols.map((c) => c.column_name).sort()).toEqual(['fields', 'list_id', 'updated_at', 'user_id']);
  });

  it('accepts the app\'s field definitions for every one of the twelve presets', async () => {
    const keys = [...V2_PRESETS, ...MORE_PRESETS].map((p) => p.key);
    expect(keys).toHaveLength(12);
    expect(Object.keys(PRESET_FIELDS).sort()).toEqual([...keys].sort());
    for (const k of keys) {
      const ok = (await q<{ ok: boolean }>(`SELECT public.lv2_fields_ok($1::jsonb) AS ok`, [JSON.stringify(fieldsForPreset(k))]))[0].ok;
      expect(ok, k).toBe(true);
    }
  });

  it('leaves every existing table, column, policy and function exactly as it was', async () => {
    expect(await shape()).toEqual(before.shape);
    expect(await policies()).toEqual(before.policies);
    expect(await functions()).toEqual(before.functions);
  });
});

describe('the owner', () => {
  it('saves fields and values, and reads them back after reopening', async () => {
    await setFields(OWNER, L_BEANS, BEANS_FIELDS);
    await setValues(OWNER, I_HALO, L_BEANS, {
      c_roaster: SECRET, c_roast: 'Light-Medium', c_best_for: ['Espresso', 'Pour-over'], c_taste: ['Jasmine', 'peach tea'],
      c_altitude: 2100, c_roast_date: '2026-11-02',
    });
    const back = await as(OWNER, () => q<{ values: Record<string, unknown> }>(`SELECT "values" FROM custom_list_item_owner_values WHERE item_id = $1`, [I_HALO]));
    expect(back[0].values).toEqual({
      c_roaster: SECRET, c_roast: 'Light-Medium', c_best_for: ['Espresso', 'Pour-over'], c_taste: ['Jasmine', 'peach tea'],
      c_altitude: 2100, c_roast_date: '2026-11-02',
    });
  });

  it('can leave every optional field empty: an item with no details has no row at all, and an empty row is fine', async () => {
    expect(await valuesOf(I_PERU)).toBeUndefined();
    await setValues(OWNER, I_PERU, L_BEANS, {});
    expect(await valuesOf(I_PERU)).toEqual({});
  });

  it('edits keep only what was sent (clearing a field removes its key)', async () => {
    await setValues(OWNER, I_HALO, L_BEANS, { c_roaster: SECRET, c_roast: 'Dark' });
    expect(await valuesOf(I_HALO)).toEqual({ c_roaster: SECRET, c_roast: 'Dark' });
  });

  it('never changes the item itself: name, notes, rating, status and photos stay as they were', async () => {
    const itemsBefore = await items();
    await setValues(OWNER, I_HALO, L_BEANS, { c_roaster: SECRET, c_roast: 'Medium', c_taste: ['Cocoa'] });
    await setFields(OWNER, L_WINES, [{ key: 'c_producer', label: 'Producer', type: 'text' }]);
    await setValues(OWNER, I_RIOJA, L_WINES, { c_producer: 'La Rioja Alta' });
    expect(await items()).toEqual(itemsBefore);
  });
});

describe('validation', () => {
  it('refuses values that do not fit their field', async () => {
    await refused(setValues(OWNER, I_HALO, L_BEANS, { c_roast: 'Burnt' }), /does not fit/);
    await refused(setValues(OWNER, I_HALO, L_BEANS, { c_best_for: ['Espresso', 'Turkish'] }), /does not fit/);
    await refused(setValues(OWNER, I_HALO, L_BEANS, { c_best_for: ['Espresso', 'Espresso'] }), /does not fit/);
    await refused(setValues(OWNER, I_HALO, L_BEANS, { c_altitude: '2100' }), /does not fit/);
    await refused(setValues(OWNER, I_HALO, L_BEANS, { c_roast_date: '2026-02-30' }), /does not fit/);
    await refused(setValues(OWNER, I_HALO, L_BEANS, { c_vintage: 2019 }), /not defined/);
    await refused(setValues(OWNER, I_HALO, L_BEANS, { notes: 'x' }));
  });

  it('refuses a value row whose item is on another list', async () => {
    await refused(setValues(OWNER, I_RIOJA, L_BEANS, { c_roaster: 'x' }), /not on list/);
  });

  it('refuses malformed definitions', async () => {
    await refused(setFields(OWNER, L_WINES, [{ key: 'producer', label: 'Producer', type: 'text' }]));
    await refused(setFields(OWNER, L_WINES, [{ key: 'c_colour', label: 'Colour', type: 'choice' }]));
    await refused(setFields(OWNER, L_WINES, [{ key: 'c_colour', label: 'Colour', type: 'multi', options: ['Red', 'Red'] }]));
    await refused(setFields(OWNER, L_WINES, [{ key: 'c_a', label: 'A', type: 'text' }, { key: 'c_a', label: 'B', type: 'text' }]));
  });

  it('refuses a definition change that would strand saved values', async () => {
    // c_roast has 'Medium' saved: it can't lose that option, or become a type 'Medium' doesn't fit.
    const noMedium = BEANS_FIELDS.map((f) => (f.key === 'c_roast' ? { ...f, options: ['Light', 'Dark'] } : f));
    await refused(setFields(OWNER, L_BEANS, noMedium), /still has saved values/);
    const asNumber = BEANS_FIELDS.map((f) => (f.key === 'c_roast' ? { key: 'c_roast', label: 'Roast', type: 'number' } : f));
    await refused(setFields(OWNER, L_BEANS, asNumber), /still has saved values/);
    await refused(setFields(OWNER, L_BEANS, BEANS_FIELDS.filter((f) => f.key !== 'c_roaster')), /still has saved values/);
  });
});

describe('hide, delete, export (decisions O1 and O3)', () => {
  it('hiding a field keeps its values, and they can still be edited', async () => {
    const hidden = BEANS_FIELDS.map((f) => (f.key === 'c_roaster' ? { ...f, hidden: true } : f));
    await setFields(OWNER, L_BEANS, hidden);
    expect((await valuesOf(I_HALO)).c_roaster).toBe(SECRET);
    await setValues(OWNER, I_HALO, L_BEANS, { ...(await valuesOf(I_HALO)), c_roaster: 'Tide' });
    await setFields(OWNER, L_BEANS, BEANS_FIELDS);
    expect((await valuesOf(I_HALO)).c_roaster).toBe('Tide');
    await setValues(OWNER, I_HALO, L_BEANS, { ...(await valuesOf(I_HALO)), c_roaster: SECRET });
  });

  it('deleting a field needs the current count, then removes its values and definition together', async () => {
    await setValues(OWNER, I_PERU, L_BEANS, { c_taste: ['Caramel'] });
    const count = (await as(OWNER, () => q<{ n: number }>(`SELECT public.count_custom_list_field_values($1, 'c_taste') AS n`, [L_BEANS])))[0].n;
    expect(count).toBe(2);
    await refused(as(OWNER, () => q(`SELECT public.delete_custom_list_field($1, 'c_taste', 1)`, [L_BEANS])), /count changed/);
    expect((await as(OWNER, () => q<{ n: number }>(`SELECT public.delete_custom_list_field($1, 'c_taste', 2) AS n`, [L_BEANS])))[0].n).toBe(2);
    expect((await valuesOf(I_HALO)).c_taste).toBeUndefined();
    expect((await valuesOf(I_HALO)).c_roaster).toBe(SECRET);
    const fields = (await q<{ fields: { key: string }[] }>(`SELECT fields FROM custom_list_owner_settings WHERE list_id = $1`, [L_BEANS]))[0].fields;
    expect(fields.map((f) => f.key)).not.toContain('c_taste');
    await setFields(OWNER, L_BEANS, BEANS_FIELDS);
  });

  it('the owner export holds the owner\'s definitions and values, without user ids', async () => {
    const out = (await as(OWNER, () => q<{ e: { settings: Record<string, unknown>[]; values: Record<string, unknown>[] } }>(`SELECT public.export_my_list_owner_data() AS e`)))[0].e;
    expect(out.settings.map((s) => s.list_id).sort()).toEqual([L_BEANS, L_WINES].sort());
    expect(out.values.find((v) => v.item_id === I_HALO)?.values).toMatchObject({ c_roaster: SECRET });
    expect(JSON.stringify(out)).not.toContain(OWNER);
  });
});

describe('privacy: owner only (decision O2)', () => {
  it('the follower still sees the list and its items exactly as today', async () => {
    const lists = await readAs(FOLLOWER, `SELECT id FROM custom_lists WHERE user_id = $1 ORDER BY id`, [OWNER]);
    expect(lists).toEqual([{ id: L_BEANS }, { id: L_WINES }]);
    const its = await readAs(FOLLOWER, `SELECT name, notes FROM custom_list_items WHERE id = $1`, [I_HALO]);
    expect(its).toEqual([{ name: 'Halo Beriti', notes: 'Bright and floral' }]);
  });

  it('the follower, a stranger and a signed-out visitor get no fields or values', async () => {
    for (const who of [FOLLOWER, STRANGER]) {
      expect(await readAs(who, `SELECT * FROM custom_list_owner_settings`)).toEqual([]);
      expect(await readAs(who, `SELECT * FROM custom_list_item_owner_values`)).toEqual([]);
      expect(await readAs(who, `SELECT public.count_custom_list_field_values($1, 'c_roaster') AS n`, [L_BEANS])).toEqual([{ n: 0 }]);
      const exp = await readAs(who, `SELECT public.export_my_list_owner_data() AS e`) as { e: unknown }[];
      expect(exp[0].e).toEqual({ settings: [], values: [] });
    }
    expect(await readAs(null, `SELECT * FROM custom_list_owner_settings`)).toBe('refused');
    expect(await readAs(null, `SELECT * FROM custom_list_item_owner_values`)).toBe('refused');
    expect(await readAs(null, `SELECT public.export_my_list_owner_data()`)).toBe('refused');
  });

  it('nobody else can write, change or delete the owner\'s fields or values', async () => {
    await refused(setValues(FOLLOWER, I_HALO, L_BEANS, { c_roaster: 'hacked' }));
    await refused(setValues(STRANGER, I_HALO, L_BEANS, { c_roaster: 'hacked' }));
    await refused(setFields(FOLLOWER, L_BEANS, []));
    await refused(as(FOLLOWER, () => q(`SELECT public.delete_custom_list_field($1, 'c_roaster', 1)`, [L_BEANS])), /no such field/);
    const changed = await as(STRANGER, () => q(`UPDATE custom_list_item_owner_values SET "values" = '{}' RETURNING item_id`));
    expect(changed).toEqual([]);
    expect(await as(STRANGER, () => q(`DELETE FROM custom_list_owner_settings RETURNING list_id`))).toEqual([]);
    expect((await valuesOf(I_HALO)).c_roaster).toBe(SECRET);
  });

  it('the owner cannot attach values to another person\'s list either', async () => {
    await refused(setFields(OWNER, L_THEIRS, [{ key: 'c_roaster', label: 'Roaster', type: 'text' }]));
  });

  it('existing discovery, previews and anonymous lists never include the values', async () => {
    await setFields(OWNER, L_ANON, BEANS_FIELDS);
    await setValues(OWNER, I_ANON, L_ANON, { c_roaster: SECRET });
    const token = (await q<{ t: string }>(`SELECT discovery_token::text AS t FROM custom_lists WHERE id = $1`, [L_ANON]))[0].t;
    const outputs = [
      await readAs(STRANGER, `SELECT public.get_discoverable_list($1) AS v`, [token]),
      await readAs(FOLLOWER, `SELECT * FROM public.get_explore_lists('all', NULL, 50, 0)`),
      await readAs(null, `SELECT public.get_shared_preview('custom_list', $1) AS v`, [L_BEANS]),
      await readAs(FOLLOWER, `SELECT public.get_shared_preview('custom_list', $1) AS v`, [L_BEANS]),
    ];
    expect(JSON.stringify(outputs[0])).toContain('Anon bean'); // the anonymous view itself still works
    for (const o of outputs) expect(JSON.stringify(o)).not.toContain(SECRET);
  });
});

describe('recovery that keeps saved details (park / unpark)', () => {
  it('parking hides both tables from the app and keeps every row; unparking brings them back unchanged', async () => {
    const valuesBefore = await q(`SELECT * FROM custom_list_item_owner_values ORDER BY item_id`);
    const settingsBefore = await q(`SELECT * FROM custom_list_owner_settings ORDER BY list_id`);
    expect(valuesBefore.length).toBeGreaterThan(0);
    await db.exec(PARK);
    await db.exec(PARK); // safe twice
    // The app's reads now fail as "no such table", which the app treats as "details not available".
    await refused(as(OWNER, () => q(`SELECT * FROM custom_list_item_owner_values`)), /does not exist/);
    await refused(as(OWNER, () => q(`SELECT * FROM lv2_parked.custom_list_item_owner_values`)), /permission denied/);
    await refused(as(OWNER, () => q(`SELECT public.export_my_list_owner_data()`)), /permission denied/);
    expect(await q(`SELECT * FROM lv2_parked.custom_list_item_owner_values ORDER BY item_id`)).toEqual(valuesBefore);
    // Lists and items keep working while parked.
    expect(await readAs(FOLLOWER, `SELECT name FROM custom_list_items WHERE id = $1`, [I_HALO])).toEqual([{ name: 'Halo Beriti' }]);
    await db.exec(UNPARK);
    await db.exec(UNPARK);
    expect(await q(`SELECT * FROM custom_list_item_owner_values ORDER BY item_id`)).toEqual(valuesBefore);
    expect(await q(`SELECT * FROM custom_list_owner_settings ORDER BY list_id`)).toEqual(settingsBefore);
    const mine = await as(OWNER, () => q<{ values: Record<string, unknown> }>(`SELECT "values" FROM custom_list_item_owner_values WHERE item_id = $1`, [I_HALO]));
    expect(mine[0].values.c_roaster).toBe(SECRET);
    expect(await readAs(FOLLOWER, `SELECT * FROM custom_list_item_owner_values`)).toEqual([]); // still owner-only
  });

  it('the full rollback refuses while saved details exist, unless a backup is confirmed', async () => {
    await refused(db.exec(ROLLBACK), /refusing to delete/);
    await db.exec('ROLLBACK').catch(() => {});
    expect((await q<{ r: string | null }>(`SELECT to_regclass('public.custom_list_item_owner_values')::text AS r`))[0].r).toBe('custom_list_item_owner_values');
  });
});

describe('removal', () => {
  it('deleting an item or a list removes its values with it', async () => {
    await as(OWNER, () => q(`DELETE FROM custom_list_items WHERE id = $1`, [I_ANON]));
    expect(await valuesOf(I_ANON)).toBeUndefined();
    await as(OWNER, () => q(`DELETE FROM custom_lists WHERE id = $1`, [L_ANON]));
    expect(await q(`SELECT 1 FROM custom_list_owner_settings WHERE list_id = $1`, [L_ANON])).toEqual([]);
  });

  it('the rollback (backup confirmed) removes only what was added, and the existing schema is as before', async () => {
    await db.exec(`SET lv2.confirm_delete_saved_details = 'backup-taken'; ${ROLLBACK}`);
    for (const t of NEW_TABLES) expect((await q<{ r: string | null }>(`SELECT to_regclass($1)::text AS r`, [`public.${t}`]))[0].r).toBeNull();
    expect(await shape()).toEqual(before.shape);
    expect(await policies()).toEqual(before.policies);
    expect(await functions()).toEqual(before.functions);
    expect((await items()).map((i) => i.name)).toContain('Halo Beriti');
  });
});
