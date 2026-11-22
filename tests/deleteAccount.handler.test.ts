// @vitest-environment node
// delete-account's order of operations with fake Supabase clients and a fake Apple.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeleteAccountHandler } from '../supabase/functions/delete-account/handler';
import { sha256Hex, type AppleConfig } from '../supabase/functions/delete-account/apple';

const NONCE = 'n'.repeat(64);
const USER = 'u-1';
let events: string[];
let identities: Array<Record<string, unknown>>;
let discardResults: Array<{ data: unknown; error: unknown }>;
let deleteError: unknown;
let revokeStatus: number;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function fakeAdmin() {
  const chain = (table: string) => {
    const done = async () => { events.push(`cleanup:${table}`); return { error: null }; };
    return { delete: () => ({ eq: done, or: done }), insert: async () => ({ error: null }) };
  };
  return {
    auth: {
      admin: {
        getUserById: async (id: string) => { events.push('getUserById'); return { data: { user: { id, identities } }, error: null }; },
        deleteUser: async () => { events.push('deleteUser'); return { error: deleteError }; },
      },
    },
    rpc: async (name: string) => { events.push(`rpc:${name}`); return discardResults.shift() ?? { data: { eligible: true, reasons: [] }, error: null }; },
    from: chain,
    storage: { from: (bucket: string) => ({ list: async () => { events.push(`storage:${bucket}`); return { data: [], error: null }; }, remove: async () => ({ error: null }) }) },
  };
}

const anon = (ok = true) => ({
  auth: { getUser: async () => (ok ? { data: { user: { id: USER, email: 'Ada@Example.com' } }, error: null } : { data: { user: null }, error: new Error('bad jwt') }) },
});

async function appleConfig(): Promise<AppleConfig> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  return {
    teamId: 'TEAM', keyId: 'KID', privateKeyPem: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----`,
    allowedClientIds: ['com.afiyeat.app'], allowedRedirectUris: [],
  };
}

const appleFetch = vi.fn(async (url: string, init?: RequestInit) => {
  const form = new URLSearchParams(String(init?.body));
  if (url.endsWith('/auth/token')) {
    events.push('apple:token');
    const idToken = `${b64({ alg: 'RS256' })}.${b64({ iss: 'https://appleid.apple.com', aud: form.get('client_id'), sub: 'apple-sub', nonce: await sha256Hex(NONCE) })}.s`;
    return new Response(JSON.stringify({ refresh_token: 'REFRESH-SECRET', access_token: 'ACCESS-SECRET', id_token: idToken }), { status: 200 });
  }
  events.push('apple:revoke');
  return new Response('', { status: revokeStatus });
});

async function call(body?: unknown, opts: { config?: AppleConfig | null; authOk?: boolean } = {}) {
  const handler = createDeleteAccountHandler({
    createAnonClient: () => anon(opts.authOk ?? true),
    createAdminClient: () => fakeAdmin(),
    appleConfig: opts.config === undefined ? await appleConfig() : opts.config,
    fetch: appleFetch,
  });
  const res = await handler(new Request('https://x/functions/v1/delete-account', {
    method: 'POST',
    headers: { authorization: 'Bearer jwt', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
}

const appleIdentity = { provider: 'apple', id: 'apple-sub', identity_data: { sub: 'apple-sub' } };
const apple = { authorization_code: 'code', client_id: 'com.afiyeat.app', nonce: NONCE };

beforeEach(() => {
  events = [];
  identities = [{ provider: 'email', id: USER, identity_data: { sub: USER } }];
  discardResults = [];
  deleteError = null;
  revokeStatus = 200;
  appleFetch.mockClear();
});

describe('capabilities probe', () => {
  it('answers without a session and touches nothing', async () => {
    const handler = createDeleteAccountHandler({
      createAnonClient: () => { throw new Error('must not authenticate'); },
      createAdminClient: () => { throw new Error('must not use admin'); },
      appleConfig: null,
      fetch: appleFetch,
    });
    const res = await handler(new Request('https://x/functions/v1/delete-account', { method: 'POST', headers: { 'x-afiyeat-probe': 'capabilities' } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ capabilities: ['apple_revocation', 'discard_new_account'] });
    expect(events).toEqual([]);
  });
});

describe('accounts without Apple (unchanged behaviour)', () => {
  it('the original call with no body still deletes, then cleans up rows and files', async () => {
    const res = await call(undefined);
    expect(res).toEqual({ status: 200, body: { success: true, apple_revocation: 'not_applicable' } });
    expect(events[0]).toBe('getUserById');
    expect(events[1]).toBe('deleteUser');
    expect(events).toEqual(expect.arrayContaining(['cleanup:shared_lists', 'cleanup:recipes', 'cleanup:email_otp', 'storage:restaurant-images']));
    expect(appleFetch).not.toHaveBeenCalled();
  });

  it('works without any Apple secrets configured', async () => {
    expect((await call(undefined, { config: null })).status).toBe(200);
  });

  it('rejects a bad session and unknown modes before touching anything', async () => {
    expect((await call(undefined, { authOk: false })).status).toBe(401);
    expect((await call({ mode: 'everything' })).status).toBe(400);
    expect(events).not.toContain('deleteUser');
  });
});

describe('accounts with Apple', () => {
  beforeEach(() => { identities = [appleIdentity]; });

  it('asks for Apple confirmation first and deletes nothing without it', async () => {
    expect(await call(undefined)).toEqual({ status: 409, body: { error: 'apple_reauth_required' } });
    expect(events).not.toContain('deleteUser');
  });

  it('revokes Apple BEFORE deleting the account', async () => {
    const res = await call({ apple });
    expect(res).toEqual({ status: 200, body: { success: true, apple_revocation: 'revoked' } });
    expect(events.slice(0, 4)).toEqual(['getUserById', 'apple:token', 'apple:revoke', 'deleteUser']);
  });

  it('if Apple is down nothing is deleted - unless the person chooses to delete anyway', async () => {
    revokeStatus = 503;
    expect(await call({ apple })).toEqual({ status: 502, body: { error: 'apple_revoke_failed' } });
    expect(events).not.toContain('deleteUser');
    events = [];
    expect(await call({ apple, continue_without_apple_revocation: true })).toEqual({ status: 200, body: { success: true, apple_revocation: 'skipped' } });
    expect(events).toContain('deleteUser');
  });

  it('a different Apple account is refused and never revoked', async () => {
    identities = [{ provider: 'apple', id: 'other-sub', identity_data: { sub: 'other-sub' } }];
    expect(await call({ apple })).toEqual({ status: 400, body: { error: 'apple_identity_mismatch' } });
    expect(events).not.toContain('apple:revoke');
    expect(events).not.toContain('deleteUser');
  });

  it('client ids outside the allow-list never reach Apple', async () => {
    expect(await call({ apple: { ...apple, client_id: 'com.evil.app' } })).toEqual({ status: 400, body: { error: 'apple_request_invalid' } });
    expect(appleFetch).not.toHaveBeenCalled();
  });

  it('without Apple secrets: says so, and allows deleting anyway', async () => {
    expect(await call({ apple }, { config: null })).toEqual({ status: 503, body: { error: 'apple_not_configured' } });
    expect((await call({ continue_without_apple_revocation: true }, { config: null })).body).toEqual({ success: true, apple_revocation: 'skipped' });
  });

  it('if deletion fails after revoking, the account is intact and the reply says so', async () => {
    deleteError = new Error('db down');
    expect(await call({ apple })).toEqual({ status: 500, body: { error: 'Failed to delete account', apple_revocation: 'revoked' } });
    expect(events).not.toContain('cleanup:shared_lists');
  });

  it('never logs Apple tokens', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    revokeStatus = 400;
    await call({ apple });
    const logged = spy.mock.calls.flat().map(String).join(' ');
    expect(logged).not.toMatch(/REFRESH-SECRET|ACCESS-SECRET|BEGIN PRIVATE KEY/);
    spy.mockRestore();
  });
});

describe('discard_new_account ("Already have an Afiyeat account?")', () => {
  it('refuses an account with data and deletes nothing, before any Apple request', async () => {
    identities = [appleIdentity];
    discardResults = [{ data: { eligible: false, reasons: ['has_rows:restaurants.user_id'] }, error: null }];
    expect(await call({ mode: 'discard_new_account', apple })).toEqual({
      status: 409, body: { error: 'account_not_discardable', reasons: ['has_rows:restaurants.user_id'] },
    });
    expect(appleFetch).not.toHaveBeenCalled();
    expect(events).not.toContain('deleteUser');
  });

  it('is unavailable (and deletes nothing) until the SQL proposal is applied', async () => {
    identities = [{ provider: 'google', id: 'g', identity_data: {} }];
    discardResults = [{ data: null, error: { message: 'function public.social_account_discard_check does not exist' } }];
    expect(await call({ mode: 'discard_new_account' })).toEqual({ status: 503, body: { error: 'discard_check_unavailable' } });
    expect(events).not.toContain('deleteUser');
  });

  it('checks again right before deleting an eligible new Google account', async () => {
    identities = [{ provider: 'google', id: 'g', identity_data: {} }];
    expect((await call({ mode: 'discard_new_account' })).status).toBe(200);
    expect(events.filter((e) => e === 'rpc:social_account_discard_check')).toHaveLength(2);
    expect(events.indexOf('deleteUser')).toBeGreaterThan(events.lastIndexOf('rpc:social_account_discard_check'));
  });

  it('an eligible new Apple account is revoked, re-checked, then deleted', async () => {
    identities = [appleIdentity];
    expect((await call({ mode: 'discard_new_account', apple })).body).toEqual({ success: true, apple_revocation: 'revoked' });
    expect(events.slice(0, 6)).toEqual(['getUserById', 'rpc:social_account_discard_check', 'apple:token', 'apple:revoke', 'rpc:social_account_discard_check', 'deleteUser']);
  });
});
