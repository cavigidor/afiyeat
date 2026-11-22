// Settings for Sign in with Apple and Continue with Google.
//
// Nothing here is secret. Client secrets, the Apple .p8 key and the Google
// OAuth client secret live only in the backend's auth settings (Lovable
// Cloud > Users > Settings), never in the app. See
// docs/social-sign-in/OWNER_SETUP.md for what each value must match.

export type SocialProvider = 'apple' | 'google';

/**
 * The custom URL scheme the iOS app receives the Google (and browser-Apple)
 * sign-in result on. It's handed to ASWebAuthenticationSession, which
 * catches the redirect itself and returns it only to the app that started
 * the sign-in; the scheme is deliberately NOT registered in Info.plist, so
 * no other app or web page can open Afiyeat with it.
 *
 * The full URL must be in the backend's Redirect URLs allow-list.
 */
export const NATIVE_CALLBACK_SCHEME = 'com.afiyeat.app';
export const NATIVE_REDIRECT_URL = `${NATIVE_CALLBACK_SCHEME}://auth/callback`;

/**
 * Where a browser sign-in on the website comes back to. It's a small
 * static page (public/auth-callback.html) rather than an app route, so the
 * one-time code and any error never reach the main sign-in client's own
 * URL detection - which would otherwise sign a signed-in person out when
 * they cancel connecting an account - and never land in browser history.
 *
 * Each origin it's used from (https://afiyeat.com, https://www.afiyeat.com)
 * must be in the Redirect URLs allow-list.
 */
export const WEB_CALLBACK_PATH = '/auth-callback.html';
export const WEB_CALLBACK_ROUTE = '/auth/callback';

/**
 * How Sign in with Apple runs inside the iPhone app.
 *
 *   'native'  - Apple's own sheet (Face ID, no password typing). Needs the
 *               app's bundle id (com.afiyeat.app) accepted as an Apple
 *               client id in the backend.
 *   'browser' - Apple's web sign-in in a secure system browser sheet. Use
 *               only if the backend can hold just one Apple client id and
 *               it has to be the Services ID for the website.
 *
 * VITE_APPLE_SIGN_IN_IOS overrides it at build time.
 */
export const APPLE_ON_IOS: 'native' | 'browser' =
  import.meta.env.VITE_APPLE_SIGN_IN_IOS === 'browser' ? 'browser' : 'native';

/**
 * Whether the website (afiyeat.com) offers Sign in with Apple. Needs an
 * Apple Services ID and client secret in the backend. Set
 * VITE_APPLE_SIGN_IN_WEB=off to hide it on the web only.
 */
export const APPLE_ON_WEB = import.meta.env.VITE_APPLE_SIGN_IN_WEB !== 'off';

/** A browser sign-in that hasn't come back within this long is abandoned. */
export const PENDING_FLOW_TTL_MS = 15 * 60 * 1000;

/** Version stamp recorded when a new social account accepts the Terms. */
export const TERMS_VERSION = '2026-10-07';

export const PROVIDER_LABEL: Record<SocialProvider, string> = {
  apple: 'Apple',
  google: 'Google',
};

/** Button wording, per each provider's own guidelines. */
export function providerButtonLabel(provider: SocialProvider, mode: 'signin' | 'signup'): string {
  if (provider === 'apple') return mode === 'signup' ? 'Sign up with Apple' : 'Sign in with Apple';
  return 'Continue with Google';
}
