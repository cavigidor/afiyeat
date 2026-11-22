import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { isNative } from '@/lib/native';
import {
  APPLE_ON_IOS,
  NATIVE_CALLBACK_SCHEME,
  NATIVE_REDIRECT_URL,
  WEB_CALLBACK_PATH,
  type SocialProvider,
} from './config';
import {
  parseCallbackParams,
  parseNativeCallbackUrl,
  readPendingFlow,
  SocialAuthCancelled,
  type CallbackResult,
  type PendingFlow,
} from './callback';
import { AfiyeatAuth, randomNonce, type AppleCredential } from './nativeAuth';
import { clearPkceStorage, createPkceClient, forgetPkceSession } from './pkceClient';

// Sign in with Apple / Continue with Google, and connecting either one to
// an account that already exists.
//
// iPhone app
//   Apple  - native sheet -> identity token (with a one-time nonce) ->
//            signInWithIdToken / linkIdentity on the main client.
//   Google - PKCE URL from the helper client -> ASWebAuthenticationSession
//            -> one-time code -> exchanged by the helper client -> session
//            handed to the main client.
// Website
//   Both   - the same PKCE URL, opened as a normal page redirect; the
//            result comes back through public/auth-callback.html and is
//            finished by the /auth/callback route (completeWebCallback).
//
// Existing accounts are never replaced: the backend links a Google or
// Apple sign-in to the account with the same verified email, keeping its
// id and everything attached to it. When the emails differ (Apple's Hide
// My Email, a different Gmail), the person connects the provider from
// Profile > Sign-in methods while signed in, which also keeps the id.

const PENDING_KEY = 'afiyeat-signin-pending';
export const CALLBACK_PAYLOAD_KEY = 'afiyeat-signin-callback';

type Intent = 'signin' | 'link';

function webRedirectUrl(): string {
  return `${window.location.origin}${WEB_CALLBACK_PATH}`;
}

function queryParamsFor(provider: SocialProvider): Record<string, string> | undefined {
  // After signing out, let the person pick a different Google account
  // instead of being signed straight back in to the last one.
  return provider === 'google' ? { prompt: 'select_account' } : undefined;
}

async function handOver(session: Session | null, expectUserId?: string): Promise<void> {
  if (!session?.access_token || !session.refresh_token) {
    throw new Error('No session came back from the sign-in.');
  }
  if (expectUserId && session.user?.id !== expectUserId) {
    // A connect flow must come back as the same account it started from.
    throw new Error('identity_already_exists');
  }
  const { error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) throw error;
}

function throwIfError(result: CallbackResult): asserts result is { kind: 'code'; code: string } {
  if (result.kind === 'code') return;
  if (result.kind === 'empty') throw new Error('No sign-in result came back.');
  const err = new Error(result.description || result.code) as Error & { code?: string };
  err.code = result.code;
  throw err;
}

// ---------------------------------------------------------------- Apple

async function nativeAppleCredential(): Promise<{ credential: AppleCredential; nonce: string }> {
  const nonce = randomNonce();
  try {
    const credential = await AfiyeatAuth.signInWithApple({ nonce });
    if (!credential?.identityToken) throw new Error('Apple returned no identity token.');
    return { credential, nonce };
  } catch (error) {
    if ((error as { code?: string })?.code === 'CANCELLED') throw new SocialAuthCancelled();
    throw error;
  }
}

/**
 * Apple shares the person's name only the first time they authorise the
 * app, and never puts it in the token. Keep it so account setup can
 * suggest it as the display name. Never overwrites a name already there.
 */
async function rememberAppleName(credential: AppleCredential): Promise<void> {
  const fullName = [credential.givenName, credential.familyName].filter(Boolean).join(' ').trim();
  if (!fullName) return;
  const { data } = await supabase.auth.getUser();
  if (data.user?.user_metadata?.full_name) return;
  await supabase.auth.updateUser({ data: { full_name: fullName } }).catch(() => undefined);
}

async function nativeAppleSignIn(): Promise<void> {
  const { credential, nonce } = await nativeAppleCredential();
  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce,
  });
  if (error) throw error;
  await rememberAppleName(credential);
}

async function nativeAppleLink(): Promise<void> {
  const { credential, nonce } = await nativeAppleCredential();
  const { error } = await supabase.auth.linkIdentity({
    provider: 'apple',
    token: credential.identityToken,
    nonce,
  });
  if (error) throw error;
  await rememberAppleName(credential);
}

// ------------------------------------------------- browser-based (PKCE)

async function startUrl(
  client: ReturnType<typeof createPkceClient>,
  provider: SocialProvider,
  intent: Intent,
  redirectTo: string,
): Promise<string> {
  const options = { redirectTo, skipBrowserRedirect: true, queryParams: queryParamsFor(provider) };
  if (intent === 'link') {
    // The helper client needs the signed-in session to ask for a link URL.
    // getSession() on the main client refreshes it first if needed, so the
    // helper (which never refreshes) gets tokens that are still valid.
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) throw new Error('Please sign in again first.');
    const set = await client.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (set.error) throw set.error;
    const { data: link, error } = await client.auth.linkIdentity({ provider, options });
    if (error) throw error;
    if (!link?.url) throw new Error('No sign-in address came back.');
    return link.url;
  }
  const { data, error } = await client.auth.signInWithOAuth({ provider, options });
  if (error) throw error;
  if (!data?.url) throw new Error('No sign-in address came back.');
  return data.url;
}

async function nativeBrowserFlow(provider: SocialProvider, intent: Intent): Promise<void> {
  clearPkceStorage();
  const client = createPkceClient();
  const userId = intent === 'link' ? (await supabase.auth.getUser()).data.user?.id : undefined;
  try {
    const url = await startUrl(client, provider, intent, NATIVE_REDIRECT_URL);
    let callbackUrl: string;
    try {
      ({ url: callbackUrl } = await AfiyeatAuth.openAuthSession({ url, callbackScheme: NATIVE_CALLBACK_SCHEME }));
    } catch (error) {
      if ((error as { code?: string })?.code === 'CANCELLED') throw new SocialAuthCancelled();
      throw error;
    }
    const result = parseNativeCallbackUrl(callbackUrl, NATIVE_REDIRECT_URL);
    throwIfError(result);
    const { data, error } = await client.auth.exchangeCodeForSession(result.code);
    if (error) throw error;
    await handOver(data.session, userId);
  } finally {
    clearPkceStorage();
  }
}

async function webRedirectFlow(provider: SocialProvider, intent: Intent): Promise<void> {
  clearPkceStorage();
  const client = createPkceClient();
  const userId = intent === 'link' ? (await supabase.auth.getUser()).data.user?.id : undefined;
  const url = await startUrl(client, provider, intent, webRedirectUrl());
  forgetPkceSession();
  const pending: PendingFlow = { intent, provider, startedAt: Date.now(), userId };
  window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  window.location.assign(url);
  // The page is navigating away; keep the caller's spinner up meanwhile.
  await new Promise<never>(() => undefined);
}

// ---------------------------------------------------------------- public

/** Signs in (or up) with Apple or Google. Rejects with SocialAuthCancelled on cancel. */
export async function signInWithProvider(provider: SocialProvider): Promise<void> {
  if (isNative()) {
    if (provider === 'apple' && APPLE_ON_IOS === 'native') return nativeAppleSignIn();
    return nativeBrowserFlow(provider, 'signin');
  }
  return webRedirectFlow(provider, 'signin');
}

/** Connects Apple or Google to the signed-in account, keeping its id. */
export async function linkProvider(provider: SocialProvider): Promise<void> {
  if (isNative()) {
    if (provider === 'apple' && APPLE_ON_IOS === 'native') return nativeAppleLink();
    return nativeBrowserFlow(provider, 'link');
  }
  return webRedirectFlow(provider, 'link');
}

/**
 * Finishes a website sign-in after public/auth-callback.html has parked
 * the redirect's parameters. Each piece is read once and removed, so
 * reloading the page or going back can't replay it.
 */
export async function completeWebCallback(): Promise<PendingFlow> {
  const payloadRaw = window.sessionStorage.getItem(CALLBACK_PAYLOAD_KEY);
  const pendingRaw = window.sessionStorage.getItem(PENDING_KEY);
  window.sessionStorage.removeItem(CALLBACK_PAYLOAD_KEY);
  window.sessionStorage.removeItem(PENDING_KEY);

  const pending = readPendingFlow(pendingRaw);
  try {
    if (!pending) throw new Error('flow_state_not_found');
    let payload: { search?: string; hash?: string } = {};
    try {
      payload = payloadRaw ? JSON.parse(payloadRaw) : {};
    } catch {
      payload = {};
    }
    const result = parseCallbackParams(payload.search ?? '', payload.hash ?? '');
    throwIfError(result);
    const client = createPkceClient();
    const { data, error } = await client.auth.exchangeCodeForSession(result.code);
    if (error) throw error;
    await handOver(data.session, pending.intent === 'link' ? pending.userId : undefined);
    return pending;
  } catch (error) {
    (error as { pending?: PendingFlow | null }).pending = pending;
    throw error;
  } finally {
    clearPkceStorage();
  }
}

/** Drops anything a half-finished sign-in left behind (used on sign-out). */
export function clearSocialAuthLeftovers(): void {
  clearPkceStorage();
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
    window.sessionStorage.removeItem(CALLBACK_PAYLOAD_KEY);
  } catch {
    /* nothing stored */
  }
}
