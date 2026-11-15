#!/usr/bin/env node
// Two-account test of the status/category owner check, against the ISOLATED backend only.
//
//   ISOLATED_SUPABASE_URL=... ISOLATED_SUPABASE_ANON_KEY=... \
//   ACCOUNT_A_EMAIL=... ACCOUNT_A_PASSWORD=... ACCOUNT_B_EMAIL=... ACCOUNT_B_PASSWORD=... \
//   node security/owner-check.isolated.mjs --expect gap     # before the addendum is applied there
//   node security/owner-check.isolated.mjs --expect fixed   # after
//
// Uses only the public (anon) key and two ordinary test accounts, exactly like the app.
// It refuses to run against production. It deletes only lists it created in this run, as their owner.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PRODUCTION_REF = 'dmlkjpjubneqhbqoxlct';
const env = (k) => { const v = process.env[k]; if (!v) { console.error(`Missing ${k}`); process.exit(2); } return v; };
const URL_ = env('ISOLATED_SUPABASE_URL');
const KEY = env('ISOLATED_SUPABASE_ANON_KEY');
const expectIdx = process.argv.indexOf('--expect');
const EXPECT = process.argv[expectIdx + 1];
if (!['gap', 'fixed'].includes(EXPECT)) { console.error('Use --expect gap or --expect fixed'); process.exit(2); }

// Guard: never production.
const repoEnv = (() => { try { return readFileSync(path.resolve(new URL('.', import.meta.url).pathname, '../../.env'), 'utf8'); } catch { return ''; } })();
const prodUrl = (repoEnv.match(/^VITE_SUPABASE_URL\s*=\s*"?([^"\n]+)"?/m) ?? [])[1];
if (URL_.includes(PRODUCTION_REF) || (prodUrl && URL_.replace(/\/$/, '') === prodUrl.replace(/\/$/, ''))) {
  console.error('Refusing to run: this is the production backend.'); process.exit(3);
}

const client = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
async function signIn(email, password) {
  const c = client();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return { c, id: data.user.id };
}
const A = await signIn(env('ACCOUNT_A_EMAIL'), env('ACCOUNT_A_PASSWORD'));
const B = await signIn(env('ACCOUNT_B_EMAIL'), env('ACCOUNT_B_PASSWORD'));

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -- ${detail}`}`); };
const tag = `owner-check ${new Date().toISOString()}`;
const created = [];
const one = async (q) => { const { data, error } = await q; if (error) throw new Error(error.message); return data; };

try {
  // Owner's ordinary flows: create a list with statuses and a category, as the app does.
  const listA = (await one(A.c.from('custom_lists').insert({ user_id: A.id, name: `${tag} A` }).select('id').single())).id; created.push([A, listA]);
  const sA = await one(A.c.from('custom_list_statuses').insert([{ list_id: listA, user_id: A.id, name: 'To Try', sort_order: 0 }, { list_id: listA, user_id: A.id, name: 'Tried', sort_order: 1 }]).select('id, name'));
  const tA = (await one(A.c.from('custom_list_types').insert({ list_id: listA, user_id: A.id, name: 'Red' }).select('id').single())).id;
  check('owner creates a list, two statuses and a category', sA.length === 2 && !!tA);

  const ren = await A.c.from('custom_list_statuses').update({ name: 'Want to Try', sort_order: 1 }).eq('id', sA[0].id).select('id');
  check('owner renames and reorders a status', !ren.error && ren.data.length === 1, ren.error?.message);
  const renT = await A.c.from('custom_list_types').update({ name: 'Reds' }).eq('id', tA).select('id');
  check('owner renames a category', !renT.error && renT.data.length === 1, renT.error?.message);
  const item = await A.c.from('custom_list_items').insert({ list_id: listA, user_id: A.id, name: 'Barolo', status_id: sA[1].id, type_ids: [tA] }).select('id');
  check('owner adds an item with a status and category', !item.error && item.data.length === 1, item.error?.message);

  // Foreign inserts into A's list.
  const fs = await B.c.from('custom_list_statuses').insert({ list_id: listA, user_id: B.id, name: 'Injected status' }).select('id');
  const ft = await B.c.from('custom_list_types').insert({ list_id: listA, user_id: B.id, name: 'Injected category' }).select('id');
  if (EXPECT === 'gap') {
    check('GAP PRESENT: B can insert a status into A\'s list', !fs.error, fs.error?.message);
    check('GAP PRESENT: B can insert a category into A\'s list', !ft.error, ft.error?.message);
  } else {
    check('B cannot insert a status into A\'s list', !!fs.error, 'insert succeeded');
    check('B cannot insert a category into A\'s list', !!ft.error, 'insert succeeded');
  }

  // Moving B's own rows onto A's list.
  const listB = (await one(B.c.from('custom_lists').insert({ user_id: B.id, name: `${tag} B` }).select('id').single())).id; created.push([B, listB]);
  const sB = (await one(B.c.from('custom_list_statuses').insert({ list_id: listB, user_id: B.id, name: 'Mine' }).select('id').single())).id;
  const tB = (await one(B.c.from('custom_list_types').insert({ list_id: listB, user_id: B.id, name: 'Mine' }).select('id').single())).id;
  const mvS = await B.c.from('custom_list_statuses').update({ list_id: listA }).eq('id', sB).select('id');
  const mvT = await B.c.from('custom_list_types').update({ list_id: listA }).eq('id', tB).select('id');
  if (EXPECT === 'gap') {
    check('GAP PRESENT: B can move its status onto A\'s list', !mvS.error && mvS.data.length === 1, mvS.error?.message);
    check('GAP PRESENT: B can move its category onto A\'s list', !mvT.error && mvT.data.length === 1, mvT.error?.message);
  } else {
    check('B cannot move its status onto A\'s list', !!mvS.error || mvS.data.length === 0, 'move succeeded');
    check('B cannot move its category onto A\'s list', !!mvT.error || mvT.data.length === 0, 'move succeeded');
  }

  // Never allowed, before or after: changing or deleting A's own rows.
  const upd = await B.c.from('custom_list_statuses').update({ name: 'Hijacked' }).eq('id', sA[0].id).select('id');
  check('B cannot rename A\'s status', !!upd.error || upd.data.length === 0);
  const del = await B.c.from('custom_list_types').delete().eq('id', tA).select('id');
  check('B cannot delete A\'s category', !!del.error || del.data.length === 0);

  // What the owner now sees.
  const seen = await one(A.c.from('custom_list_statuses').select('name, user_id').eq('list_id', listA));
  const foreign = seen.filter((r) => r.user_id !== A.id).length;
  if (EXPECT === 'gap') check('GAP PRESENT: A\'s list now shows statuses A did not create', foreign > 0, `foreign=${foreign}`);
  else check('A\'s list shows only A\'s own statuses', foreign === 0, `foreign=${foreign}`);

  // Regression: owner deletes a status and the list still works.
  const delOwn = await A.c.from('custom_list_statuses').delete().eq('id', sA[0].id).select('id');
  check('owner deletes a status', !delOwn.error && delOwn.data.length === 1, delOwn.error?.message);
} finally {
  // Clean up only what this run created, each by its owner. Injected rows on A's list go with A's list (cascade).
  for (const [who, id] of created.reverse()) await who.c.from('custom_lists').delete().eq('id', id);
}
console.log(`\n${pass} passed, ${fail} failed (expect=${EXPECT}, backend=${new URL(URL_).host})`);
process.exit(fail ? 1 : 0);
