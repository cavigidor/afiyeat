import { supabase } from '@/integrations/supabase/client';
import { isNative } from '@/lib/native';
import { isCancellation } from '@/lib/socialAuth/callback';
import { appleWebReauthorize } from '@/lib/socialAuth/appleWeb';
import { randomNonce } from '@/lib/socialAuth/nativeAuth';
import { nativeAppleCredential } from '@/lib/socialAuth/socialAuth';

// Deleting the signed-in account, and the setup screen's "Already have an
// Afiyeat account?" (mode discard_new_account).
//
// Accounts without Apple: exactly the original call (no body), so nothing
// changes for them and it works with any version of delete-account.
//
// Accounts with Apple connected: the person confirms with Apple once more
// (native sheet on iPhone, Apple's popup on the website). The fresh,
// single-use code goes to delete-account, which revokes Afiyeat's Apple
// authorization BEFORE deleting (App Review 5.1.1(v), Apple TN3194). If
// that can't happen, the person chooses: try again, or delete anyway and
// remove Afiyeat from their Apple Account settings themselves.
//
// Anything relying on the new function first asks it what it supports
// (capabilities probe). The previous function ignores the request body and
// deletes on any signed-in call, so a discard request is never sent to it.

export type DeletionMode = 'delete' | 'discard_new_account';

export type AppleProblem = 'cancelled' | 'unavailable' | 'failed' | 'mismatch';

export type DeletionResult =
  | { status: 'deleted'; appleRevocation?: 'revoked' | 'skipped' | 'not_applicable' }
  | { status: 'apple_problem'; reason: AppleProblem }
  | { status: 'not_discardable' }
  | { status: 'unavailable' }
  | { status: 'error' };

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-account`;

/** Whether the deployed delete-account supports Apple revocation and safe discard. */
export async function deleteAccountCapabilities(): Promise<string[]> {
  try {
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'x-afiyeat-probe': 'capabilities' },
    });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body?.capabilities) ? body.capabilities : [];
  } catch {
    return [];
  }
}

async function hasAppleIdentity(): Promise<boolean> {
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error) throw error;
  return (data?.identities ?? []).some((identity) => identity.provider === 'apple');
}

interface AppleBody {
  authorization_code: string;
  client_id: string;
  nonce: string;
  redirect_uri?: string;
}

async function confirmWithApple(): Promise<AppleBody> {
  if (isNative()) {
    const { credential, nonce } = await nativeAppleCredential();
    if (!credential.authorizationCode || !credential.clientId) {
      throw Object.assign(new Error('Apple returned no authorization code.'), { code: 'FAILED' });
    }
    return { authorization_code: credential.authorizationCode, client_id: credential.clientId, nonce };
  }
  const nonce = randomNonce();
  const { code, clientId, redirectUri } = await appleWebReauthorize(nonce);
  return { authorization_code: code, client_id: clientId, nonce, redirect_uri: redirectUri };
}

async function errorBody(error: unknown, data: unknown): Promise<{ error?: string }> {
  if (data && typeof data === 'object' && 'error' in data) return data as { error?: string };
  const context = (error as { context?: Response } | null)?.context;
  if (context && typeof context.json === 'function') {
    try {
      return await context.clone().json();
    } catch {
      return {};
    }
  }
  return {};
}

const APPLE_ERRORS: Record<string, AppleProblem> = {
  apple_reauth_required: 'failed',
  apple_reauth_failed: 'failed',
  apple_request_invalid: 'failed',
  apple_revoke_failed: 'unavailable',
  apple_not_configured: 'unavailable',
  apple_identity_mismatch: 'mismatch',
};

export async function deleteMyAccount({
  mode,
  continueWithoutApple = false,
}: {
  mode: DeletionMode;
  continueWithoutApple?: boolean;
}): Promise<DeletionResult> {
  let apple: boolean;
  try {
    apple = await hasAppleIdentity();
  } catch {
    return { status: 'error' };
  }

  // Original behaviour, unchanged: plain delete of an account without Apple.
  if (mode === 'delete' && !apple) {
    const { data, error } = await supabase.functions.invoke('delete-account');
    if (error || (data && data.error)) return { status: 'error' };
    return { status: 'deleted', appleRevocation: 'not_applicable' };
  }

  const capabilities = await deleteAccountCapabilities();
  if (mode === 'discard_new_account' && !capabilities.includes('discard_new_account')) {
    return { status: 'unavailable' };
  }

  const body: Record<string, unknown> = { mode };
  if (apple) {
    if (continueWithoutApple) {
      body.continue_without_apple_revocation = true;
    } else if (!capabilities.includes('apple_revocation')) {
      return { status: 'apple_problem', reason: 'unavailable' };
    } else {
      try {
        body.apple = await confirmWithApple();
      } catch (error) {
        if (isCancellation(error)) return { status: 'apple_problem', reason: 'cancelled' };
        const code = (error as { code?: string } | null)?.code;
        return { status: 'apple_problem', reason: code === 'UNAVAILABLE' ? 'unavailable' : 'failed' };
      }
    }
  }

  const { data, error } = await supabase.functions.invoke('delete-account', { body });
  if (!error && data?.success) return { status: 'deleted', appleRevocation: data.apple_revocation };

  const reply = await errorBody(error, data);
  if (reply.error === 'account_not_discardable') return { status: 'not_discardable' };
  if (reply.error === 'discard_check_unavailable') return { status: 'unavailable' };
  if (reply.error && reply.error in APPLE_ERRORS) return { status: 'apple_problem', reason: APPLE_ERRORS[reply.error] };
  return { status: 'error' };
}
