// @vitest-environment node
//
// db/proposals/social_sign_in/social_sign_in_account_safety.sql on a database that holds every
// migration in supabase/migrations (production's schema, policies included). In-process Postgres
// (PGlite) only - never connects anywhere.
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { replayMigrations } from './fixtures/replayMigrations';

const proposal = (f: string) =>
  readFileSync(new URL(`../db/proposals/social_sign_in/${f}`, import.meta.url), 'utf8');
const SQL = proposal('social_sign_in_account_safety.sql');
const PRECHECK = proposal('social_sign_in_account_safety_precheck.sql');
const POSTCHECK = proposal('social_sign_in_account_safety_postcheck.sql');
const ROLLBACK = proposal('social_sign_in_account_safety_rollback.sql');

const id = (n: number) => `51000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const VERSIONS = ['2026-10-07', '2026-10-07'];

let db: PGlite;
let next = 100;
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
// Lovable's runner: the whole file as one query inside one transaction.
const applyLikeRunner = (sql: string) => db.transaction(async (tx) => { await tx.exec(sql); });

async function as<T>(uid: string | null, role: 'authenticated' | 'anon' | 'service_role', fn: () => Promise<T>): Promise<T> {
  await db.exec(`SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await fn(); } finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`); }
}
const refused = async (p: Promise<unknown>, pattern?: RegExp) => {
  let err: unknown = null;
  try { await p; } catch (e) { err = e; }
  expect(err, 'expected the statement to be refused').toBeTruthy();
  if (pattern) expect(`${(err as Error).message} ${(err as { code?: string }).code ?? ''}`).toMatch(pattern);
};

/** A user as GoTrue creates one: auth.users + identity rows; the real trigger adds profile + folders. */
async function makeUser(opts: { provider?: string; identities?: string[]; ageDays?: number; email?: string } = {}) {
  const uid = id(next++);
  const provider = opts.provider ?? 'google';
  await q(
    `INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at)
     VALUES ($1, $2, $3, '{}', now() - make_interval(days => $4))`,
    [uid, opts.email ?? `${uid.slice(-4)}@example.com`, JSON.stringify({ provider, providers: opts.identities ?? [provider] }), opts.ageDays ?? 0],
  );
  for (const p of opts.identities ?? [provider]) {
    await q(`INSERT INTO auth.identities (id, user_id, provider, provider_id, identity_data) VALUES ($1, $2, $3, $1, '{}')`,
      [`${p}-${uid}`, uid, p]);
  }
  return uid;
}
const discard = async (uid: string) =>
  (await as(null, 'service_role', () => q<{ r: { eligible: boolean; reasons: string[] } }>(
    'SELECT public.social_account_discard_check($1) AS r', [uid])))[0].r;

beforeAll(async () => {
  db = await replayMigrations();
  // GoTrue's identities table (the shared stubs predate it).
  await db.exec(`CREATE TABLE auth.identities (id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider text NOT NULL, provider_id text, identity_data jsonb, created_at timestamptz DEFAULT now());`);
}, 120_000);

describe('applying the proposal', () => {
  it('precheck passes on the current schema, the file applies as one transaction, postcheck passes', async () => {
    const pre = await q<{ check: string; ok: boolean }>(PRECHECK);
    expect(pre.filter((r) => !r.ok)).toEqual([]);
    expect(pre).toHaveLength(10);
    await applyLikeRunner(SQL);
    const post = await q<{ check: string; ok: boolean }>(POSTCHECK);
    expect(post.filter((r) => !r.ok)).toEqual([]);
    expect(post).toHaveLength(9);
  });

  it('changed no existing function, policy or trigger', async () => {
    const own = await q<{ n: number }>(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
      WHERE s.nspname = 'public' AND p.proname IN ('complete_account_setup','social_sign_in_ready','social_account_discard_check')`);
    expect(own[0].n).toBe(3);
    const handle = await q<{ src: string }>(`SELECT prosrc src FROM pg_proc WHERE proname = 'handle_new_user'`);
    expect(handle[0].src).toContain('seed_default_folders');
  });
});

describe('terms acceptance record', () => {
  beforeEach(async () => { await db.exec(`RESET ROLE`); });

  it('complete_account_setup saves the profile and records acceptance with a server timestamp', async () => {
    const uid = await makeUser();
    expect((await q(`SELECT username FROM profiles WHERE user_id = $1`, [uid]))[0]).toEqual({ username: null });
    await as(uid, 'authenticated', () => q(`SELECT public.complete_account_setup('  ada_l ', 'Ada L', $1, $2)`, VERSIONS));
    expect((await q(`SELECT username, display_name FROM profiles WHERE user_id = $1`, [uid]))[0]).toEqual({ username: 'ada_l', display_name: 'Ada L' });
    const rows = await q<{ terms_version: string; method: string; recent: boolean }>(
      `SELECT terms_version, method, accepted_at > now() - interval '1 minute' AS recent FROM terms_acceptances WHERE user_id = $1`, [uid]);
    expect(rows).toEqual([{ terms_version: '2026-10-07', method: 'account_setup', recent: true }]);
    // Running it again (e.g. a retry) keeps one row.
    await as(uid, 'authenticated', () => q(`SELECT public.complete_account_setup('ada_l', '', $1, $2)`, VERSIONS));
    expect(await q(`SELECT 1 FROM terms_acceptances WHERE user_id = $1`, [uid])).toHaveLength(1);
    expect((await q(`SELECT display_name FROM profiles WHERE user_id = $1`, [uid]))[0]).toEqual({ display_name: 'ada_l' });
  });

  it('a taken username records nothing at all', async () => {
    const first = await makeUser();
    await as(first, 'authenticated', () => q(`SELECT public.complete_account_setup('taken_name', null, $1, $2)`, VERSIONS));
    const second = await makeUser();
    await refused(as(second, 'authenticated', () => q(`SELECT public.complete_account_setup('taken_name', null, $1, $2)`, VERSIONS)), /23505|unique/);
    expect(await q(`SELECT 1 FROM terms_acceptances WHERE user_id = $1`, [second])).toHaveLength(0);
    expect((await q(`SELECT username FROM profiles WHERE user_id = $1`, [second]))[0]).toEqual({ username: null });
  });

  it('refuses old or invented versions, bad usernames, and signed-out callers', async () => {
    const uid = await makeUser();
    await refused(as(uid, 'authenticated', () => q(`SELECT public.complete_account_setup('okname', null, '2025-01-01', '2026-10-07')`)), /terms_version_mismatch/);
    await refused(as(uid, 'authenticated', () => q(`SELECT public.complete_account_setup('ab', null, $1, $2)`, VERSIONS)), /invalid_username/);
    await refused(as(uid, 'authenticated', () => q(`SELECT public.complete_account_setup($3, null, $1, $2)`, [...VERSIONS, 'x'.repeat(21)])), /invalid_username/);
    await refused(as(uid, 'authenticated', () => q(`SELECT public.complete_account_setup('okname', $3, $1, $2)`, [...VERSIONS, 'x'.repeat(51)])), /invalid_display_name/);
    await refused(as(null, 'anon', () => q(`SELECT public.complete_account_setup('okname', null, $1, $2)`, VERSIONS)), /permission denied/);
    expect(await q(`SELECT 1 FROM terms_acceptances WHERE user_id = $1`, [uid])).toHaveLength(0);
  });

  it('accounts read only their own rows and can never write, change or remove one', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await as(a, 'authenticated', () => q(`SELECT public.complete_account_setup('reader_a', null, $1, $2)`, VERSIONS));
    await as(b, 'authenticated', () => q(`SELECT public.complete_account_setup('reader_b', null, $1, $2)`, VERSIONS));
    const seen = await as(a, 'authenticated', () => q<{ user_id: string }>(`SELECT user_id FROM terms_acceptances`));
    expect(seen.map((r) => r.user_id)).toEqual([a]);
    await refused(as(a, 'authenticated', () => q(`INSERT INTO terms_acceptances (user_id, terms_version, privacy_version, method) VALUES ($1, '2026-10-07', '2026-10-07', 'account_setup')`, [a])), /permission denied/);
    await refused(as(a, 'authenticated', () => q(`UPDATE terms_acceptances SET accepted_at = now() - interval '1 year'`)), /permission denied/);
    await refused(as(a, 'authenticated', () => q(`DELETE FROM terms_acceptances`)), /permission denied/);
    await refused(as(null, 'anon', () => q(`SELECT * FROM terms_acceptances`)), /permission denied/);
  });

  it('deleting the account deletes its acceptance rows', async () => {
    const uid = await makeUser();
    await as(uid, 'authenticated', () => q(`SELECT public.complete_account_setup('gone_soon', null, $1, $2)`, VERSIONS));
    await q(`DELETE FROM auth.users WHERE id = $1`, [uid]);
    expect(await q(`SELECT 1 FROM terms_acceptances WHERE user_id = $1`, [uid])).toHaveLength(0);
  });

  it('readiness probe answers signed out', async () => {
    expect(await as(null, 'anon', () => q(`SELECT public.social_sign_in_ready() AS v`))).toEqual([{ v: 'v1' }]);
  });
});

describe('discard safeguard', () => {
  it('only service_role may run it', async () => {
    const uid = await makeUser();
    await refused(as(uid, 'authenticated', () => q(`SELECT public.social_account_discard_check($1)`, [uid])), /permission denied/);
    await refused(as(null, 'anon', () => q(`SELECT public.social_account_discard_check($1)`, [uid])), /permission denied/);
  });

  it('allows a brand-new, untouched Apple or Google account (profile + seeded folders only)', async () => {
    for (const provider of ['apple', 'google']) {
      const uid = await makeUser({ provider });
      expect(await q(`SELECT 1 FROM folders WHERE user_id = $1`, [uid])).toHaveLength(7);
      await q(`INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, 'ios')`, [uid, `tok-${uid}`]);
      expect(await discard(uid)).toEqual({ eligible: true, reasons: [] });
    }
  });

  it('refuses accounts not created by Apple/Google, old ones, and ones with other sign-in methods', async () => {
    expect((await discard(await makeUser({ provider: 'email' }))).reasons).toEqual(
      expect.arrayContaining(['not_created_by_apple_or_google', 'has_email_or_other_identity']));
    expect((await discard(await makeUser({ ageDays: 8 }))).reasons).toEqual(['older_than_7_days']);
    expect((await discard(await makeUser({ provider: 'google', identities: ['google', 'email'] }))).reasons).toEqual(
      expect.arrayContaining(['has_other_sign_in_methods', 'has_email_or_other_identity']));
    expect((await discard(await makeUser({ provider: 'apple', identities: ['apple', 'google'] }))).reasons).toEqual(['has_other_sign_in_methods']);
    expect((await discard('00000000-0000-4000-8000-000000000000')).reasons).toEqual(['no_such_user']);
  });

  it('refuses once setup is done or the profile has any details', async () => {
    const done = await makeUser();
    await as(done, 'authenticated', () => q(`SELECT public.complete_account_setup('finished_1', null, $1, $2)`, VERSIONS));
    expect((await discard(done)).reasons).toEqual(expect.arrayContaining(['profile_has_details', 'accepted_terms']));
    const bio = await makeUser();
    await q(`UPDATE profiles SET bio = 'hi' WHERE user_id = $1`, [bio]);
    expect((await discard(bio)).reasons).toEqual(['profile_has_details']);
  });

  it('refuses when folders were changed', async () => {
    const renamed = await makeUser();
    await q(`UPDATE folders SET name = 'Date night' WHERE user_id = $1 AND name = 'Dinner'`, [renamed]);
    expect((await discard(renamed)).reasons).toEqual(['folders_changed']);
    const extra = await makeUser();
    await q(`INSERT INTO folders (user_id, name, color) VALUES ($1, 'Lunch', '#FF9800')`, [extra]);
    expect((await discard(extra)).reasons).toEqual(['folders_changed']);
  });

  it('refuses any content or relationship, found through foreign keys', async () => {
    const owner = await makeUser();
    const folder = (await q<{ id: string }>(`SELECT id FROM folders WHERE user_id = $1 LIMIT 1`, [owner]))[0].id;
    await q(`INSERT INTO restaurants (user_id, folder_id, name) VALUES ($1, $2, 'Cafe X')`, [owner, folder]);
    expect((await discard(owner)).reasons).toEqual(['has_rows:restaurants.user_id']);

    const followed = await makeUser();
    const fan = await makeUser({ provider: 'email' });
    await q(`INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)`, [fan, followed]);
    expect((await discard(followed)).reasons).toEqual(['has_rows:follows.following_id']);

    const referred = await makeUser();
    await q(`INSERT INTO referrals (referrer_user_id, referred_user_id, referral_code) VALUES ($1, $2, 'X1')`, [fan, referred]);
    expect((await discard(referred)).reasons).toEqual(expect.arrayContaining(['has_rows:referrals.referred_user_id']));
  });

  it('refuses rows in tables without a foreign key, and uploaded files', async () => {
    const cook = await makeUser();
    await q(`INSERT INTO recipes (user_id, title) VALUES ($1, 'Soup')`, [cook]);
    expect((await discard(cook)).reasons).toEqual(['has_rows:recipes.user_id']);

    const photographer = await makeUser();
    await q(`INSERT INTO storage.buckets (id, name) VALUES ('restaurant-images', 'restaurant-images') ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO storage.objects (bucket_id, name) VALUES ('restaurant-images', $1)`, [`${photographer}/a.jpg`]);
    expect((await discard(photographer)).reasons).toEqual(['has_uploaded_files']);
  });
});

describe('rollback', () => {
  it('refuses while acceptances exist, then removes only what the proposal added once confirmed', async () => {
    await refused(applyLikeRunner(ROLLBACK), /terms_acceptances has rows/);
    expect(await q(`SELECT to_regclass('public.terms_acceptances') IS NOT NULL AS still`)).toEqual([{ still: true }]);
    await applyLikeRunner(`SELECT set_config('afiyeat.confirm_drop_terms_acceptances', 'backup-taken', true);\n${ROLLBACK}`);
    expect(await q(`SELECT to_regclass('public.terms_acceptances') AS t`)).toEqual([{ t: null }]);
    const left = await q(`SELECT proname FROM pg_proc WHERE proname IN ('complete_account_setup','social_sign_in_ready','social_account_discard_check')`);
    expect(left).toEqual([]);
    const pre = await q<{ ok: boolean }>(PRECHECK);
    expect(pre.every((r) => r.ok)).toBe(true);
  });
});
