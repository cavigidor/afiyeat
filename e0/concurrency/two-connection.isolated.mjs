#!/usr/bin/env node
// PREPARED, NOT RUN. Two-client concurrency and retry tests for Schema A through the real Supabase API
// (PostgREST + Auth), against the APPROVED isolated project only.
//
// Preconditions, each checked or stated:
//   - lib/approved-target.mjs approves "concurrency-tests" for this project (checked; refuses otherwise);
//   - the isolated project has the baseline, the pending stack migrations and Schema A applied - Schema A in a
//     hosted project needs its own PM authorization (checked: stops if create_list_from_preset is missing);
//   - two ordinary TEST accounts that exist only in the isolated project; never real users.
//
//   ISOLATED_SUPABASE_URL=https://<ref>.supabase.co ISOLATED_SUPABASE_ANON_KEY=<anon key of that project> \
//   E0_CONFIRM_PROJECT_REF=<ref> ACCOUNT_A_EMAIL=... ACCOUNT_A_PASSWORD=... ACCOUNT_B_EMAIL=... ACCOUNT_B_PASSWORD=... \
//   node concurrency/two-connection.isolated.mjs [--rounds 10]
//
// "Two devices" = two independently signed-in clients for account A (separate sessions, separate HTTP
// connections). Every scenario is repeated --rounds times, because over HTTP the overlap cannot be forced the
// way the local test forces it with an open transaction; the local test (two-connection.local.test.mjs)
// is the proof of the database behaviour, this run is the check that the API path behaves the same.
// It deletes only the lists it created in this run, as their owner, and prints what it deleted.
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { assertApprovedTarget } from '../lib/approved-target.mjs';

const env = (k) => { const v = process.env[k]; if (!v) { console.error(`Missing ${k}`); process.exit(2); } return v; };
const URL_ = env('ISOLATED_SUPABASE_URL'), KEY = env('ISOLATED_SUPABASE_ANON_KEY');
try { assertApprovedTarget({ operation: 'concurrency-tests', apiUrl: URL_ }); } catch (e) { console.error(e.message); process.exit(3); }
const ROUNDS = Number(process.argv[process.argv.indexOf('--rounds') + 1]) || 10;

const signIn = async (email, password) => {
  const c = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return { c, id: data.user.id };
};
const phone = await signIn(env('ACCOUNT_A_EMAIL'), env('ACCOUNT_A_PASSWORD'));
const laptop = await signIn(env('ACCOUNT_A_EMAIL'), env('ACCOUNT_A_PASSWORD'));
const other = await signIn(env('ACCOUNT_B_EMAIL'), env('ACCOUNT_B_PASSWORD'));
if (phone.id !== laptop.id || phone.id === other.id) { console.error('ACCOUNT_A and ACCOUNT_B must be two different accounts'); process.exit(2); }

const probe = await phone.c.rpc('create_list_from_preset', { p_id: null, p_name: 'probe' });
if (probe.error && /could not find the function|schema cache/i.test(probe.error.message)) {
  console.error('Schema A is not in this project. It needs separate authorization before this test can run.'); process.exit(4);
}

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -- ${detail}`}`); };
const created = [];
const tag = `e0-concurrency ${new Date().toISOString()}`;
const rows = async (q) => { const { data, error } = await q; if (error) throw new Error(error.message); return data; };
const newList = async () => { const id = randomUUID(); await rows(phone.c.rpc('create_list_from_preset', { p_id: id, p_name: `${tag} list` })); created.push(id); return id; };

try {
  // I1 the same create on two devices at once
  let i1 = true, d1 = '';
  for (let r = 0; r < ROUNDS; r++) {
    const id = randomUUID(); created.push(id);
    const args = { p_id: id, p_name: `${tag} travel`, p_preset_key: 'travel', p_preset_version: 1 };
    const [a, b] = await Promise.all([phone.c.rpc('create_list_from_preset', args), laptop.c.rpc('create_list_from_preset', args)]);
    const lists = await rows(phone.c.from('custom_lists').select('id, visibility').eq('id', id));
    const statuses = await rows(phone.c.from('custom_list_statuses').select('id').eq('list_id', id));
    if (a.error || b.error || a.data !== id || b.data !== id || lists.length !== 1 || statuses.length !== 2 || lists[0].visibility !== 'private') {
      i1 = false; d1 = JSON.stringify({ a: a.error?.message, b: b.error?.message, lists, statuses: statuses.length });
    }
  }
  check(`I1 same create on two devices x${ROUNDS}: one list, statuses once, both succeed, Travel Only me`, i1, d1);

  // I2 / I3 checklist adds
  const list = await newList();
  const [status] = await rows(phone.c.from('custom_list_statuses').select('id').eq('list_id', list).limit(1));
  let i2 = true, i3 = true, d2 = '';
  for (let r = 0; r < ROUNDS; r++) {
    const item = randomUUID();
    await rows(phone.c.from('custom_list_items').insert({ id: item, list_id: list, user_id: phone.id, name: `${tag} shop`, status_id: status.id }));
    const op = (c, o) => c.rpc('apply_checklist_op', { p_item_id: item, p_field: 'wishlist', p_op: o });
    const [x, y] = await Promise.all([op(phone.c, { op: 'add', entry: { id: `phone-${r}-0001`, text: 'Atlas' } }), op(laptop.c, { op: 'add', entry: { id: `laptop-${r}-001`, text: 'Ink' } })]);
    const same = { op: 'add', entry: { id: `retry-${r}-0001`, text: 'Scarf' } };
    const [u, v] = await Promise.all([op(phone.c, same), op(laptop.c, same)]);
    const [it] = await rows(phone.c.from('custom_list_items').select('details').eq('id', item));
    const ids = (it.details.wishlist ?? []).map((e) => e.id);
    if (x.error || y.error || !ids.includes(`phone-${r}-0001`) || !ids.includes(`laptop-${r}-001`)) { i2 = false; d2 = JSON.stringify({ x: x.error?.message, y: y.error?.message, ids }); }
    if (u.error || v.error || ids.filter((i) => i === `retry-${r}-0001`).length !== 1) { i3 = false; d2 = JSON.stringify({ u: u.error?.message, v: v.error?.message, ids }); }
  }
  check(`I2 different entries added on two devices at once x${ROUNDS}: both survive`, i2, d2);
  check(`I3 the same add sent twice at once x${ROUNDS}: stored once`, i3, d2);

  // I4 a request aborted in flight, then retried: never stored twice
  let i4 = true, d4 = '';
  for (let r = 0; r < ROUNDS; r++) {
    const item = randomUUID();
    await rows(phone.c.from('custom_list_items').insert({ id: item, list_id: list, user_id: phone.id, name: `${tag} abort`, status_id: status.id }));
    const o = { op: 'add', entry: { id: `abort-${r}-0001`, text: 'Pen' } };
    const ac = new AbortController(); setTimeout(() => ac.abort(), r % 3); // abort at 0-2 ms: before, during or after the server commits
    await phone.c.rpc('apply_checklist_op', { p_item_id: item, p_field: 'wishlist', p_op: o }).abortSignal(ac.signal);
    const retry = await laptop.c.rpc('apply_checklist_op', { p_item_id: item, p_field: 'wishlist', p_op: o });
    const [it] = await rows(phone.c.from('custom_list_items').select('details').eq('id', item));
    if (retry.error || (it.details.wishlist ?? []).filter((e) => e.id === o.entry.id).length !== 1) { i4 = false; d4 = JSON.stringify({ retry: retry.error?.message, w: it.details.wishlist }); }
  }
  check(`I4 aborted request then retry x${ROUNDS}: exactly one entry`, i4, d4);

  // I5 different detail keys from two devices
  let i5 = true, d5 = '';
  for (let r = 0; r < ROUNDS; r++) {
    const item = randomUUID();
    await rows(phone.c.from('custom_list_items').insert({ id: item, list_id: list, user_id: phone.id, name: `${tag} beans`, status_id: status.id }));
    const [x, y] = await Promise.all([phone.c.rpc('patch_item_details', { p_item_id: item, p_set: { roaster: 'Tide' } }), laptop.c.rpc('patch_item_details', { p_item_id: item, p_set: { process: 'Washed' } })]);
    const [it] = await rows(phone.c.from('custom_list_items').select('details').eq('id', item));
    if (x.error || y.error || it.details.roaster !== 'Tide' || it.details.process !== 'Washed') { i5 = false; d5 = JSON.stringify(it.details); }
  }
  check(`I5 different detail keys from two devices at once x${ROUNDS}: no lost update`, i5, d5);

  // I6 item insert retried with the same client id
  let i6 = true, d6 = '';
  for (let r = 0; r < ROUNDS; r++) {
    const item = randomUUID();
    const ins = (c) => c.from('custom_list_items').insert({ id: item, list_id: list, user_id: phone.id, name: `${tag} cafe`, status_id: status.id });
    const [x, y] = await Promise.all([ins(phone.c), ins(laptop.c)]);
    const n = (await rows(phone.c.from('custom_list_items').select('id').eq('id', item))).length;
    const errs = [x.error, y.error].filter(Boolean);
    if (n !== 1 || errs.length !== 1 || errs[0].code !== '23505') { i6 = false; d6 = JSON.stringify({ n, errs: errs.map((e) => e.code) }); }
  }
  check(`I6 item insert sent twice with one client id x${ROUNDS}: one row, the other sees 23505 (client treats as saved)`, i6, d6);

  // I7 another account racing for the same list id
  let i7 = true, d7 = '';
  for (let r = 0; r < ROUNDS; r++) {
    const id = randomUUID(); created.push(id);
    const [mine, theirs] = await Promise.all([phone.c.rpc('create_list_from_preset', { p_id: id, p_name: `${tag} mine` }), other.c.rpc('create_list_from_preset', { p_id: id, p_name: `${tag} theirs` })]);
    const owners = await rows(phone.c.from('custom_lists').select('user_id').eq('id', id));
    const oneWon = [mine, theirs].filter((x) => !x.error).length === 1 && [mine, theirs].some((x) => x.error?.code === '23505');
    if (!oneWon) { i7 = false; d7 = JSON.stringify({ mine: mine.error?.code, theirs: theirs.error?.code }); }
    if (!mine.error && (owners.length !== 1 || owners[0].user_id !== phone.id)) { i7 = false; d7 = JSON.stringify(owners); }
    if (theirs.error === null) created.push(`B:${id}`);
  }
  check(`I7 another account racing for one list id x${ROUNDS}: exactly one wins; the loser gets 23505 and owns nothing`, i7, d7);
} finally {
  const mine = created.filter((x) => !x.startsWith('B:'));
  if (mine.length) { const { error } = await phone.c.from('custom_lists').delete().in('id', mine).eq('user_id', phone.id); console.log(`cleanup: deleted ${mine.length} test list(s) of account A${error ? ` (error: ${error.message})` : ''}`); }
  const theirs = created.filter((x) => x.startsWith('B:')).map((x) => x.slice(2));
  if (theirs.length) { const { error } = await other.c.from('custom_lists').delete().in('id', theirs).eq('user_id', other.id); console.log(`cleanup: deleted ${theirs.length} test list(s) of account B${error ? ` (error: ${error.message})` : ''}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
