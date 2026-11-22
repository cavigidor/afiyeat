import { APPLE_ON_WEB, APPLE_SERVICES_ID, WEB_CALLBACK_PATH } from './config';
import { SocialAuthCancelled } from './callback';

// Sign in with Apple JS, used on afiyeat.com for ONE thing: asking a person
// to confirm with Apple before deleting an account that has Apple
// connected, so the server can revoke Afiyeat's Apple authorization
// (App Review 5.1.1(v), Apple TN3194). Sign-in itself on the website goes
// through the backend's OAuth flow (socialAuth.ts), not through this.
//
// The script is Apple's own, loaded only when needed. Popup mode returns
// the single-use authorization code to this page; it's sent straight to
// the delete-account function and never stored.

const SCRIPT_SRC = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

interface AppleIDAuth {
  init(config: Record<string, unknown>): void;
  signIn(): Promise<{ authorization?: { code?: string; state?: string } }>;
}
declare global {
  interface Window {
    AppleID?: { auth: AppleIDAuth };
  }
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.AppleID?.auth) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(Object.assign(new Error("Couldn't load Sign in with Apple."), { code: 'UNAVAILABLE' }));
    };
    document.head.appendChild(script);
  });
  return loading;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function appleWebReauthAvailable(): boolean {
  return APPLE_ON_WEB && !!APPLE_SERVICES_ID;
}

/**
 * Opens Apple's popup and returns a fresh authorization code for the
 * website's Services ID. `nonce` is the raw nonce; Apple puts its SHA-256
 * in the identity token, which the server checks.
 */
export async function appleWebReauthorize(nonce: string): Promise<{ code: string; clientId: string; redirectUri: string }> {
  if (!appleWebReauthAvailable()) {
    throw Object.assign(new Error('Sign in with Apple is not set up for this website.'), { code: 'UNAVAILABLE' });
  }
  await loadScript();
  const auth = window.AppleID?.auth;
  if (!auth) throw Object.assign(new Error("Couldn't load Sign in with Apple."), { code: 'UNAVAILABLE' });

  const redirectUri = `${window.location.origin}${WEB_CALLBACK_PATH}`;
  const state = crypto.getRandomValues(new Uint32Array(4)).join('-');
  auth.init({
    clientId: APPLE_SERVICES_ID,
    scope: '',
    redirectURI: redirectUri,
    state,
    nonce: await sha256Hex(nonce),
    usePopup: true,
  });
  let result: Awaited<ReturnType<AppleIDAuth['signIn']>>;
  try {
    result = await auth.signIn();
  } catch (error) {
    const reason = `${(error as { error?: unknown } | null)?.error ?? ''}`;
    if (reason === 'popup_closed_by_user' || reason === 'user_cancelled_authorize') throw new SocialAuthCancelled();
    throw Object.assign(new Error(reason || 'Sign in with Apple did not complete.'), { code: 'FAILED' });
  }
  const code = result?.authorization?.code;
  if (!code || result.authorization?.state !== state) {
    throw Object.assign(new Error('Sign in with Apple returned an unexpected response.'), { code: 'FAILED' });
  }
  return { code, clientId: APPLE_SERVICES_ID, redirectUri };
}
