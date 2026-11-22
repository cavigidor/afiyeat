import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  native: true,
  identities: [{ provider: 'email' }] as Array<{ provider: string }>,
  invoke: vi.fn(),
  invokeResult: { data: { success: true, apple_revocation: 'revoked' }, error: null } as { data: unknown; error: unknown },
  appleCredential: vi.fn(),
  appleWeb: vi.fn(),
  probe: { status: 200, body: { capabilities: ['apple_revocation', 'discard_new_account'] } as unknown },
  fetch: vi.fn(),
}));

vi.mock('@/lib/native', () => ({ isNative: () => m.native }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUserIdentities: async () => ({ data: { identities: m.identities }, error: null }) },
    functions: { invoke: async (...args: unknown[]) => { m.invoke(...args); return m.invokeResult; } },
  },
}));
vi.mock('@/lib/socialAuth/socialAuth', () => ({ nativeAppleCredential: () => m.appleCredential() }));
vi.mock('@/lib/socialAuth/appleWeb', () => ({ appleWebReauthorize: (nonce: string) => m.appleWeb(nonce) }));
vi.mock('@/lib/socialAuth/nativeAuth', () => ({ randomNonce: () => 'r'.repeat(64) }));

import { deleteMyAccount } from '@/lib/accountDeletion';
import { SocialAuthCancelled } from '@/lib/socialAuth/callback';

beforeEach(() => {
  vi.clearAllMocks();
  m.native = true;
  m.identities = [{ provider: 'email' }];
  m.invokeResult = { data: { success: true, apple_revocation: 'revoked' }, error: null };
  m.probe = { status: 200, body: { capabilities: ['apple_revocation', 'discard_new_account'] } };
  m.appleCredential.mockResolvedValue({ credential: { identityToken: 't', authorizationCode: 'native-code', clientId: 'com.afiyeat.app', user: 'u' }, nonce: 'n'.repeat(64) });
  m.fetch.mockImplementation(async () => new Response(JSON.stringify(m.probe.body), { status: m.probe.status }));
  vi.stubGlobal('fetch', m.fetch);
});

const probeCalls = () => m.fetch.mock.calls.filter(([, init]) => (init as RequestInit)?.headers && (init as { headers: Record<string, string> }).headers['x-afiyeat-probe'] === 'capabilities');

describe('accounts without Apple', () => {
  it('make exactly the original call: no body, no probe, no Apple', async () => {
    expect(await deleteMyAccount({ mode: 'delete' })).toEqual({ status: 'deleted', appleRevocation: 'not_applicable' });
    expect(m.invoke).toHaveBeenCalledWith('delete-account');
    expect(probeCalls()).toHaveLength(0);
    expect(m.appleCredential).not.toHaveBeenCalled();
  });

  it('report a failure', async () => {
    m.invokeResult = { data: null, error: new Error('500') };
    expect(await deleteMyAccount({ mode: 'delete' })).toEqual({ status: 'error' });
  });
});

describe('accounts with Apple (iPhone)', () => {
  beforeEach(() => { m.identities = [{ provider: 'apple' }]; });

  it('confirm with Apple and send the fresh code, client id and nonce', async () => {
    expect(await deleteMyAccount({ mode: 'delete' })).toEqual({ status: 'deleted', appleRevocation: 'revoked' });
    expect(m.invoke).toHaveBeenCalledWith('delete-account', {
      body: { mode: 'delete', apple: { authorization_code: 'native-code', client_id: 'com.afiyeat.app', nonce: 'n'.repeat(64) } },
    });
    expect(probeCalls()).toHaveLength(1);
  });

  it('cancelling Apple deletes nothing', async () => {
    m.appleCredential.mockRejectedValue(new SocialAuthCancelled());
    expect(await deleteMyAccount({ mode: 'delete' })).toEqual({ status: 'apple_problem', reason: 'cancelled' });
    expect(m.invoke).not.toHaveBeenCalled();
  });

  it('with the old delete-account deployed, asks before deleting without revocation', async () => {
    m.probe = { status: 401, body: { error: 'Invalid authorization' } };
    expect(await deleteMyAccount({ mode: 'delete' })).toEqual({ status: 'apple_problem', reason: 'unavailable' });
    expect(m.appleCredential).not.toHaveBeenCalled();
    expect(m.invoke).not.toHaveBeenCalled();
  });

  it('"delete anyway" skips Apple and says so to the server', async () => {
    m.invokeResult = { data: { success: true, apple_revocation: 'skipped' }, error: null };
    expect(await deleteMyAccount({ mode: 'delete', continueWithoutApple: true })).toEqual({ status: 'deleted', appleRevocation: 'skipped' });
    expect(m.appleCredential).not.toHaveBeenCalled();
    expect(m.invoke).toHaveBeenCalledWith('delete-account', { body: { mode: 'delete', continue_without_apple_revocation: true } });
  });

  it('maps server refusals from the error body', async () => {
    const reply = (body: unknown, status: number) => ({ data: null, error: Object.assign(new Error('non-2xx'), { context: new Response(JSON.stringify(body), { status }) }) });
    m.invokeResult = reply({ error: 'apple_identity_mismatch' }, 400);
    expect(await deleteMyAccount({ mode: 'delete' })).toEqual({ status: 'apple_problem', reason: 'mismatch' });
    m.invokeResult = reply({ error: 'apple_revoke_failed' }, 502);
    expect(await deleteMyAccount({ mode: 'delete' })).toEqual({ status: 'apple_problem', reason: 'unavailable' });
    m.invokeResult = reply({ error: 'apple_reauth_failed' }, 400);
    expect(await deleteMyAccount({ mode: 'delete' })).toEqual({ status: 'apple_problem', reason: 'failed' });
  });

  it('on the website, uses Apple JS and sends its redirect URI', async () => {
    m.native = false;
    m.appleWeb.mockResolvedValue({ code: 'web-code', clientId: 'com.afiyeat.web', redirectUri: 'https://afiyeat.com/auth-callback.html' });
    await deleteMyAccount({ mode: 'delete' });
    expect(m.appleWeb).toHaveBeenCalledWith('r'.repeat(64));
    expect(m.invoke).toHaveBeenCalledWith('delete-account', {
      body: { mode: 'delete', apple: { authorization_code: 'web-code', client_id: 'com.afiyeat.web', nonce: 'r'.repeat(64), redirect_uri: 'https://afiyeat.com/auth-callback.html' } },
    });
  });
});

describe('discard_new_account ("Already have an Afiyeat account?")', () => {
  it('is NEVER sent to an old delete-account (which would ignore the safeguard and delete)', async () => {
    m.identities = [{ provider: 'google' }];
    m.probe = { status: 401, body: { error: 'Invalid authorization' } };
    expect(await deleteMyAccount({ mode: 'discard_new_account' })).toEqual({ status: 'unavailable' });
    expect(m.invoke).not.toHaveBeenCalled();
    m.probe = { status: 200, body: { capabilities: ['apple_revocation'] } };
    expect(await deleteMyAccount({ mode: 'discard_new_account' })).toEqual({ status: 'unavailable' });
    expect(m.invoke).not.toHaveBeenCalled();
  });

  it('sends the mode for an eligible Google account', async () => {
    m.identities = [{ provider: 'google' }];
    m.invokeResult = { data: { success: true, apple_revocation: 'not_applicable' }, error: null };
    expect(await deleteMyAccount({ mode: 'discard_new_account' })).toEqual({ status: 'deleted', appleRevocation: 'not_applicable' });
    expect(m.invoke).toHaveBeenCalledWith('delete-account', { body: { mode: 'discard_new_account' } });
  });

  it('reports the server refusing an account with activity', async () => {
    m.identities = [{ provider: 'google' }];
    m.invokeResult = { data: null, error: Object.assign(new Error('non-2xx'), { context: new Response(JSON.stringify({ error: 'account_not_discardable', reasons: ['has_rows:restaurants.user_id'] }), { status: 409 }) }) };
    expect(await deleteMyAccount({ mode: 'discard_new_account' })).toEqual({ status: 'not_discardable' });
  });
});
