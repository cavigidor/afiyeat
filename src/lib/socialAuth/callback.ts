// Pure helpers for reading a sign-in redirect and turning failures into
// words a person can act on. No Supabase or Capacitor imports, so these
// are unit-tested directly (tests/socialAuth.callback.test.ts).

import { PENDING_FLOW_TTL_MS, PROVIDER_LABEL, type SocialProvider } from './config';

export type CallbackResult =
  | { kind: 'code'; code: string }
  | { kind: 'error'; code: string; description: string }
  | { kind: 'empty' };

/**
 * Reads the outcome of an OAuth redirect from its query and fragment.
 * The backend puts `code` in the query (PKCE); errors can arrive in either
 * the query or the fragment, so both are read and an error always wins.
 */
export function parseCallbackParams(search: string, hash: string): CallbackResult {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const fragment = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const get = (key: string) => query.get(key) ?? fragment.get(key);

  const error = get('error');
  const errorCode = get('error_code');
  const errorDescription = get('error_description');
  if (error || errorCode || errorDescription) {
    return {
      kind: 'error',
      code: errorCode || error || 'unknown_error',
      description: errorDescription || error || '',
    };
  }
  const code = query.get('code');
  if (code) return { kind: 'code', code };
  return { kind: 'empty' };
}

/**
 * Reads a callback URL handed back by the iOS system browser sheet. Only a
 * URL that starts with exactly the expected redirect is accepted, so a
 * stray or crafted URL is treated as no result at all.
 */
export function parseNativeCallbackUrl(url: string, expectedPrefix: string): CallbackResult {
  if (!url || !url.startsWith(expectedPrefix)) return { kind: 'empty' };
  const rest = url.slice(expectedPrefix.length);
  if (rest !== '' && rest[0] !== '?' && rest[0] !== '#') return { kind: 'empty' };
  const hashAt = rest.indexOf('#');
  const search = hashAt === -1 ? rest : rest.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : rest.slice(hashAt);
  return parseCallbackParams(search, hash);
}

/** What a browser sign-in on the website was for, kept across the redirect. */
export interface PendingFlow {
  intent: 'signin' | 'link';
  provider: SocialProvider;
  startedAt: number;
  /** Signed-in account a link was started from; the result must match it. */
  userId?: string;
}

export function readPendingFlow(raw: string | null, now = Date.now()): PendingFlow | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingFlow>;
    if (value.intent !== 'signin' && value.intent !== 'link') return null;
    if (value.provider !== 'apple' && value.provider !== 'google') return null;
    if (typeof value.startedAt !== 'number') return null;
    if (now - value.startedAt > PENDING_FLOW_TTL_MS || value.startedAt > now + 60_000) return null;
    if (value.intent === 'link' && typeof value.userId !== 'string') return null;
    return {
      intent: value.intent,
      provider: value.provider,
      startedAt: value.startedAt,
      userId: value.userId,
    };
  } catch {
    return null;
  }
}

/** Thrown when the person backed out. Callers show nothing for it. */
export class SocialAuthCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'SocialAuthCancelled';
  }
}

export function isCancellation(error: unknown): boolean {
  if (error instanceof SocialAuthCancelled) return true;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'CANCELLED') return true;
  const text = `${(error as { message?: unknown } | null)?.message ?? ''}`.toLowerCase();
  // OAuth "access_denied" is what Google and Apple send when the person
  // taps Cancel on their consent screen.
  return text === 'cancelled' || text.includes('access_denied') || text.includes('user denied');
}

/**
 * A short, actionable message for a failed social sign-in. Never includes
 * tokens or raw server payloads.
 */
export function friendlyAuthError(error: unknown, provider: SocialProvider): string {
  const name = PROVIDER_LABEL[provider];
  const code = `${(error as { code?: unknown } | null)?.code ?? ''}`.toLowerCase();
  const text = `${(error as { message?: unknown } | null)?.message ?? error ?? ''}`.toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => code.includes(n) || text.includes(n));

  if (has('identity_already_exists', 'already linked to another user')) {
    return `That ${name} account is already used by a different Afiyeat account. Sign in with it to use that account instead.`;
  }
  if (has('manual_linking_disabled', 'manual linking is disabled')) {
    return `Connecting a ${name} account isn't switched on yet. You can still sign in with ${name} on its own.`;
  }
  if (has('provider is not enabled', 'unsupported provider', 'provider_disabled', 'validation_failed')) {
    return `${name} sign-in isn't switched on yet. Please use email for now.`;
  }
  if (has('unacceptable audience', 'invalid audience', 'bad_jwt', 'invalid nonce', 'nonces mismatch')) {
    return `${name} sign-in isn't set up for this version of the app yet. Please use email for now.`;
  }
  if (has('signups not allowed', 'signup_disabled')) {
    return 'New accounts are paused right now. If you already have an account, sign in with email.';
  }
  if (has('unavailable')) {
    return provider === 'apple'
      ? "Sign in with Apple isn't available on this device. Check you're signed in to your Apple Account in Settings."
      : `${name} sign-in isn't available on this device.`;
  }
  if (has('failed to fetch', 'network', 'offline', 'timed out', 'timeout')) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  if (has('expired', 'flow_state_not_found', 'code verifier', 'invalid flow state', 'bad_code_verifier')) {
    return 'That sign-in took too long or was opened somewhere else. Please try again.';
  }
  return `${name} sign-in didn't work. Please try again, or use email.`;
}
