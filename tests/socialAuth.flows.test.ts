import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const session = (id: string) => ({
    access_token: `access-${id}`,
    refresh_token: `refresh-${id}`,
    user: { id },
  });
  return {
    session,
    native: { isNative: vi.fn(() => true) },
    plugin: { signInWithApple: vi.fn(), openAuthSession: vi.fn() },
    main: {
      signInWithIdToken: vi.fn(async () => ({ data: {}, error: null })),
      linkIdentity: vi.fn(async () => ({ data: {}, error: null })),
      getUser: vi.fn(async () => ({ data: { user: { id: 'me', user_metadata: {} } } })),
      updateUser: vi.fn(async () => ({ data: {}, error: null })),
      getSession: vi.fn(async () => ({ data: { session: session('me') } })),
      setSession: vi.fn(async () => ({ data: {}, error: null })),
    },
    helper: {
      signInWithOAuth: vi.fn(async () => ({ data: { url: 'https://proj.supabase.co/auth/v1/authorize?provider=google' }, error: null })),
      linkIdentity: vi.fn(async () => ({ data: { url: 'https://proj.supabase.co/auth/v1/user/identities/authorize' }, error: null })),
      setSession: vi.fn(async () => ({ data: {}, error: null })),
      exchangeCodeForSession: vi.fn(async () => ({ data: { session: session('me') }, error: null })),
    },
    clearPkceStorage: vi.fn(),
    forgetPkceSession: vi.fn(),
  };
});

vi.mock('@/lib/native', () => mocks.native);
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: mocks.main } }));
vi.mock('@/lib/socialAuth/nativeAuth', () => ({ AfiyeatAuth: mocks.plugin, randomNonce: () => 'n'.repeat(64) }));
vi.mock('@/lib/socialAuth/pkceClient', () => ({
  createPkceClient: () => ({ auth: mocks.helper }),
  clearPkceStorage: mocks.clearPkceStorage,
  forgetPkceSession: mocks.forgetPkceSession,
}));

import { completeWebCallback, linkProvider, signInWithProvider, CALLBACK_PAYLOAD_KEY } from '@/lib/socialAuth/socialAuth';
import { SocialAuthCancelled } from '@/lib/socialAuth/callback';
import { NATIVE_REDIRECT_URL } from '@/lib/socialAuth/config';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.native.isNative.mockReturnValue(true);
  window.sessionStorage.clear();
});

describe('iPhone: Sign in with Apple (native sheet)', () => {
  it('sends Apple a nonce and the backend the same raw nonce with the token', async () => {
    mocks.plugin.signInWithApple.mockResolvedValue({ identityToken: 'apple.jwt', user: 'apple-user', givenName: 'Ada', familyName: 'L' });
    await signInWithProvider('apple');
    expect(mocks.plugin.signInWithApple).toHaveBeenCalledWith({ nonce: 'n'.repeat(64) });
    expect(mocks.main.signInWithIdToken).toHaveBeenCalledWith({ provider: 'apple', token: 'apple.jwt', nonce: 'n'.repeat(64) });
    // Apple's one-time name is kept for the setup screen.
    expect(mocks.main.updateUser).toHaveBeenCalledWith({ data: { full_name: 'Ada L' } });
  });

  it("doesn't overwrite a name that's already saved", async () => {
    mocks.plugin.signInWithApple.mockResolvedValue({ identityToken: 't', user: 'u', givenName: 'New' });
    mocks.main.getUser.mockResolvedValueOnce({ data: { user: { id: 'me', user_metadata: { full_name: 'Kept' } } } });
    await signInWithProvider('apple');
    expect(mocks.main.updateUser).not.toHaveBeenCalled();
  });

  it('cancel signs nobody in and is reported as a cancellation', async () => {
    mocks.plugin.signInWithApple.mockRejectedValue(Object.assign(new Error('cancelled'), { code: 'CANCELLED' }));
    await expect(signInWithProvider('apple')).rejects.toBeInstanceOf(SocialAuthCancelled);
    expect(mocks.main.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('a backend rejection is passed on', async () => {
    mocks.plugin.signInWithApple.mockResolvedValue({ identityToken: 't', user: 'u' });
    mocks.main.signInWithIdToken.mockResolvedValueOnce({ data: {}, error: new Error('Unacceptable audience in id_token') } as never);
    await expect(signInWithProvider('apple')).rejects.toThrow(/audience/);
  });

  it('connecting Apple links the token to the signed-in account', async () => {
    mocks.plugin.signInWithApple.mockResolvedValue({ identityToken: 'apple.jwt', user: 'u' });
    await linkProvider('apple');
    expect(mocks.main.linkIdentity).toHaveBeenCalledWith({ provider: 'apple', token: 'apple.jwt', nonce: 'n'.repeat(64) });
    expect(mocks.main.signInWithIdToken).not.toHaveBeenCalled();
  });
});

describe('iPhone: Continue with Google (system browser sheet, PKCE)', () => {
  it('opens the PKCE URL in the sheet, exchanges the code and hands the session over', async () => {
    mocks.plugin.openAuthSession.mockResolvedValue({ url: `${NATIVE_REDIRECT_URL}?code=one-time` });
    await signInWithProvider('google');
    expect(mocks.helper.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: NATIVE_REDIRECT_URL, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
    });
    expect(mocks.plugin.openAuthSession).toHaveBeenCalledWith({
      url: 'https://proj.supabase.co/auth/v1/authorize?provider=google',
      callbackScheme: 'com.afiyeat.app',
    });
    expect(mocks.helper.exchangeCodeForSession).toHaveBeenCalledWith('one-time');
    expect(mocks.main.setSession).toHaveBeenCalledWith({ access_token: 'access-me', refresh_token: 'refresh-me' });
    expect(mocks.clearPkceStorage).toHaveBeenCalled();
  });

  it('cancel in the sheet is a cancellation, nothing is exchanged, and the verifier is forgotten', async () => {
    mocks.plugin.openAuthSession.mockRejectedValue(Object.assign(new Error('cancelled'), { code: 'CANCELLED' }));
    await expect(signInWithProvider('google')).rejects.toBeInstanceOf(SocialAuthCancelled);
    expect(mocks.helper.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.main.setSession).not.toHaveBeenCalled();
    expect(mocks.clearPkceStorage).toHaveBeenCalledTimes(2);
  });

  it('an error redirect (e.g. consent denied) never signs in', async () => {
    mocks.plugin.openAuthSession.mockResolvedValue({ url: `${NATIVE_REDIRECT_URL}?error=access_denied&error_description=denied` });
    await expect(signInWithProvider('google')).rejects.toThrow(/denied/);
    expect(mocks.main.setSession).not.toHaveBeenCalled();
  });

  it('a callback to any other address is ignored', async () => {
    mocks.plugin.openAuthSession.mockResolvedValue({ url: 'com.evil.app://auth/callback?code=stolen' });
    await expect(signInWithProvider('google')).rejects.toThrow(/No sign-in result/);
    expect(mocks.helper.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('connecting Google must come back as the same account', async () => {
    mocks.plugin.openAuthSession.mockResolvedValue({ url: `${NATIVE_REDIRECT_URL}?code=c` });
    mocks.helper.exchangeCodeForSession.mockResolvedValueOnce({ data: { session: mocks.session('someone-else') }, error: null } as never);
    await expect(linkProvider('google')).rejects.toThrow('identity_already_exists');
    expect(mocks.helper.setSession).toHaveBeenCalledWith({ access_token: 'access-me', refresh_token: 'refresh-me' });
    expect(mocks.helper.linkIdentity).toHaveBeenCalled();
    expect(mocks.main.setSession).not.toHaveBeenCalled();
  });
});

describe('website (afiyeat.com)', () => {
  let assign: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    mocks.native.isNative.mockReturnValue(false);
    assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, origin: 'https://afiyeat.com', assign },
    });
  });

  it('redirects with PKCE to the static callback page and remembers the intent', async () => {
    void signInWithProvider('apple');
    await vi.waitFor(() => expect(assign).toHaveBeenCalled());
    expect(mocks.helper.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'apple',
      options: { redirectTo: 'https://afiyeat.com/auth-callback.html', skipBrowserRedirect: true, queryParams: undefined },
    });
    const pending = JSON.parse(window.sessionStorage.getItem('afiyeat-signin-pending') ?? '{}');
    expect(pending).toMatchObject({ intent: 'signin', provider: 'apple' });
    expect(mocks.plugin.signInWithApple).not.toHaveBeenCalled();
  });

  it('finishes once, and a replay finds nothing', async () => {
    window.sessionStorage.setItem('afiyeat-signin-pending', JSON.stringify({ intent: 'signin', provider: 'google', startedAt: Date.now() }));
    window.sessionStorage.setItem(CALLBACK_PAYLOAD_KEY, JSON.stringify({ search: '?code=web-code', hash: '' }));
    await expect(completeWebCallback()).resolves.toMatchObject({ intent: 'signin', provider: 'google' });
    expect(mocks.helper.exchangeCodeForSession).toHaveBeenCalledWith('web-code');
    expect(mocks.main.setSession).toHaveBeenCalledTimes(1);
    await expect(completeWebCallback()).rejects.toThrow('flow_state_not_found');
    expect(mocks.main.setSession).toHaveBeenCalledTimes(1);
  });

  it('a link that comes back as a different account is refused', async () => {
    window.sessionStorage.setItem('afiyeat-signin-pending', JSON.stringify({ intent: 'link', provider: 'google', startedAt: Date.now(), userId: 'me' }));
    window.sessionStorage.setItem(CALLBACK_PAYLOAD_KEY, JSON.stringify({ search: '?code=c', hash: '' }));
    mocks.helper.exchangeCodeForSession.mockResolvedValueOnce({ data: { session: mocks.session('other') }, error: null } as never);
    await expect(completeWebCallback()).rejects.toThrow('identity_already_exists');
    expect(mocks.main.setSession).not.toHaveBeenCalled();
  });

  it('an error in the redirect is reported with the flow it belonged to', async () => {
    window.sessionStorage.setItem('afiyeat-signin-pending', JSON.stringify({ intent: 'link', provider: 'apple', startedAt: Date.now(), userId: 'me' }));
    window.sessionStorage.setItem(CALLBACK_PAYLOAD_KEY, JSON.stringify({ search: '?error=access_denied', hash: '' }));
    const error = await completeWebCallback().catch((e) => e);
    expect(error.message).toBe('access_denied');
    expect(error.pending).toMatchObject({ intent: 'link', provider: 'apple' });
    expect(mocks.helper.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
