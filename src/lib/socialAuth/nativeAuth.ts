import { registerPlugin } from '@capacitor/core';

// The app's own small iOS plugin (ios/App/App/AfiyeatNativeAuth.swift).
// It wraps two Apple system APIs and nothing else:
//   - ASAuthorizationController: the native Sign in with Apple sheet.
//   - ASWebAuthenticationSession: the secure system browser sheet used for
//     Google. Google blocks sign-in inside embedded web views; this sheet
//     is the one Apple and Google both recommend for apps (RFC 8252), and
//     its redirect is returned only to the app that opened it.
//
// Errors reject with code 'CANCELLED' (person backed out), 'UNAVAILABLE'
// (not possible on this device) or 'FAILED'.

export interface AppleCredential {
  identityToken: string;
  authorizationCode?: string;
  /** The app's bundle id: the Apple client id the code was issued to. */
  clientId?: string;
  user: string;
  email?: string;
  givenName?: string;
  familyName?: string;
}

interface AfiyeatAuthPlugin {
  /** `nonce` is the raw nonce; the plugin sends Apple its SHA-256. */
  signInWithApple(options: { nonce: string }): Promise<AppleCredential>;
  openAuthSession(options: { url: string; callbackScheme: string }): Promise<{ url: string }>;
  /**
   * Whether this iPhone's Apple Account still authorizes Afiyeat for the
   * given Apple user id. 'revoked' means the person turned off Sign in with
   * Apple for Afiyeat in Settings (Apple TN3194: sign them out).
   */
  getAppleCredentialState(options: { user: string }): Promise<{ state: 'authorized' | 'revoked' | 'notFound' | 'transferred' | 'unknown' }>;
}

export const AfiyeatAuth = registerPlugin<AfiyeatAuthPlugin>('AfiyeatAuth');

/** A random nonce for one Sign in with Apple attempt (hex, 256 bits). */
export function randomNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The Apple user id (Apple's `sub`) of an account's Apple identity, if it has one. */
export function appleUserIdOf(
  user: { identities?: Array<{ provider: string; id?: string; identity_data?: Record<string, unknown> }> } | null | undefined,
): string | null {
  const identity = user?.identities?.find((i) => i.provider === 'apple');
  if (!identity) return null;
  const sub = identity.identity_data?.sub;
  return typeof sub === 'string' && sub ? sub : identity.id ?? null;
}
