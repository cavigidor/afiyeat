import { describe, expect, it } from 'vitest';
import {
  friendlyAuthError,
  isCancellation,
  parseCallbackParams,
  parseNativeCallbackUrl,
  readPendingFlow,
  SocialAuthCancelled,
} from '@/lib/socialAuth/callback';
import { parseAuthSettings, visibleProviders } from '@/lib/socialAuth/providers';
import { NATIVE_REDIRECT_URL, providerButtonLabel } from '@/lib/socialAuth/config';

describe('parseCallbackParams', () => {
  it('reads a PKCE code from the query', () => {
    expect(parseCallbackParams('?code=abc123', '')).toEqual({ kind: 'code', code: 'abc123' });
  });

  it('prefers an error over a code, from query or fragment', () => {
    expect(parseCallbackParams('?code=x&error=access_denied', '')).toMatchObject({ kind: 'error', code: 'access_denied' });
    expect(
      parseCallbackParams('', '#error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user'),
    ).toEqual({ kind: 'error', code: 'identity_already_exists', description: 'Identity is already linked to another user' });
  });

  it('ignores tokens in a fragment (implicit flow is never used here)', () => {
    expect(parseCallbackParams('', '#access_token=t&refresh_token=r')).toEqual({ kind: 'empty' });
  });

  it('treats nothing as empty', () => {
    expect(parseCallbackParams('', '')).toEqual({ kind: 'empty' });
  });
});

describe('parseNativeCallbackUrl', () => {
  it('accepts only the exact redirect', () => {
    expect(parseNativeCallbackUrl(`${NATIVE_REDIRECT_URL}?code=c1`, NATIVE_REDIRECT_URL)).toEqual({ kind: 'code', code: 'c1' });
    expect(parseNativeCallbackUrl(`${NATIVE_REDIRECT_URL}#error=access_denied`, NATIVE_REDIRECT_URL)).toMatchObject({ kind: 'error' });
  });

  it('rejects look-alikes and other schemes', () => {
    expect(parseNativeCallbackUrl('evil://auth/callback?code=c1', NATIVE_REDIRECT_URL)).toEqual({ kind: 'empty' });
    expect(parseNativeCallbackUrl(`${NATIVE_REDIRECT_URL}-evil?code=c1`, NATIVE_REDIRECT_URL)).toEqual({ kind: 'empty' });
    expect(parseNativeCallbackUrl(`${NATIVE_REDIRECT_URL}/x?code=c1`, NATIVE_REDIRECT_URL)).toEqual({ kind: 'empty' });
    expect(parseNativeCallbackUrl('', NATIVE_REDIRECT_URL)).toEqual({ kind: 'empty' });
  });
});

describe('readPendingFlow', () => {
  const now = 1_800_000_000_000;
  it('accepts a fresh, well-formed flow', () => {
    const raw = JSON.stringify({ intent: 'signin', provider: 'google', startedAt: now - 1000 });
    expect(readPendingFlow(raw, now)).toEqual({ intent: 'signin', provider: 'google', startedAt: now - 1000, userId: undefined });
  });

  it('expires after 15 minutes', () => {
    const raw = JSON.stringify({ intent: 'signin', provider: 'apple', startedAt: now - 16 * 60 * 1000 });
    expect(readPendingFlow(raw, now)).toBeNull();
  });

  it('requires the starting account for a link', () => {
    expect(readPendingFlow(JSON.stringify({ intent: 'link', provider: 'apple', startedAt: now }), now)).toBeNull();
    expect(readPendingFlow(JSON.stringify({ intent: 'link', provider: 'apple', startedAt: now, userId: 'u1' }), now)?.userId).toBe('u1');
  });

  it('rejects junk', () => {
    expect(readPendingFlow('not json', now)).toBeNull();
    expect(readPendingFlow(JSON.stringify({ intent: 'other', provider: 'google', startedAt: now }), now)).toBeNull();
    expect(readPendingFlow(JSON.stringify({ intent: 'signin', provider: 'facebook', startedAt: now }), now)).toBeNull();
    expect(readPendingFlow(null, now)).toBeNull();
  });
});

describe('cancellation and errors', () => {
  it('recognises the ways a person backs out', () => {
    expect(isCancellation(new SocialAuthCancelled())).toBe(true);
    expect(isCancellation({ code: 'CANCELLED', message: 'cancelled' })).toBe(true);
    expect(isCancellation(new Error('access_denied'))).toBe(true);
    expect(isCancellation(new Error('Invalid login credentials'))).toBe(false);
  });

  it('gives actionable messages without echoing server details', () => {
    expect(friendlyAuthError({ code: 'identity_already_exists' }, 'apple')).toMatch(/already used by a different Afiyeat account/);
    expect(friendlyAuthError(new Error('Manual linking is disabled'), 'google')).toMatch(/isn't switched on yet/);
    expect(friendlyAuthError(new Error('Unsupported provider: provider is not enabled'), 'google')).toMatch(/Google sign-in isn't switched on yet/);
    expect(friendlyAuthError(new Error('Unacceptable audience in id_token: [com.afiyeat.app]'), 'apple')).toMatch(/isn't set up for this version/);
    expect(friendlyAuthError({ code: 'UNAVAILABLE' }, 'apple')).toMatch(/Apple Account in Settings/);
    expect(friendlyAuthError(new TypeError('Failed to fetch'), 'google')).toMatch(/connection/);
    const generic = friendlyAuthError(new Error('eyJhbGciOi.secret.token'), 'google');
    expect(generic).not.toContain('eyJ');
  });
});

describe('provider availability', () => {
  it('reads the backend settings conservatively', () => {
    expect(parseAuthSettings({ external: { apple: true, google: true, email: true } })).toEqual({ apple: true, google: true });
    expect(parseAuthSettings({ external: { apple: 'true' } })).toEqual({ apple: false, google: false });
    expect(parseAuthSettings(null)).toEqual({ apple: false, google: false });
  });

  it('puts Apple first and respects the website switch', () => {
    const both = { apple: true, google: true };
    expect(visibleProviders(both, { native: true, appleOnWeb: false, appleOnIos: 'native' })).toEqual(['apple', 'google']);
    expect(visibleProviders(both, { native: false, appleOnWeb: true, appleOnIos: 'native' })).toEqual(['apple', 'google']);
    expect(visibleProviders(both, { native: false, appleOnWeb: false, appleOnIos: 'native' })).toEqual(['google']);
    expect(visibleProviders({ apple: false, google: false }, { native: true, appleOnWeb: true, appleOnIos: 'native' })).toEqual([]);
  });

  it('labels buttons per provider guidelines', () => {
    expect(providerButtonLabel('apple', 'signin')).toBe('Sign in with Apple');
    expect(providerButtonLabel('apple', 'signup')).toBe('Sign up with Apple');
    expect(providerButtonLabel('google', 'signin')).toBe('Continue with Google');
    expect(providerButtonLabel('google', 'signup')).toBe('Continue with Google');
  });
});
