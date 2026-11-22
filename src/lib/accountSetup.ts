import type { User } from '@supabase/supabase-js';

// Rules for the one-time account setup a NEW Apple or Google account goes
// through before using the app: choose a username (and display name) and
// accept the Terms and Privacy Policy - the same things the email sign-up
// form asks for. Pure functions only (tests/accountSetup.test.ts).
//
// Who is asked: only accounts that were CREATED by Apple or Google sign-in
// (app_metadata.provider). An existing email account that later signs in
// with Google keeps provider 'email', so it is never sent through setup,
// and nothing changes for anyone who signed up with email.
//
// Acceptance is recorded server-side (public.terms_acceptances, written
// only by the complete_account_setup() function with the server's clock),
// not in the account's own editable metadata.

const SOCIAL = new Set(['apple', 'google']);

export function createdWithSocialProvider(user: Pick<User, 'app_metadata'> | null | undefined): boolean {
  const provider = user?.app_metadata?.provider;
  return typeof provider === 'string' && SOCIAL.has(provider);
}

export interface SetupNeeds {
  username: boolean;
  terms: boolean;
}

/** What the server says about the account: saved username, recorded acceptance. */
export interface SetupRecord {
  username: string | null;
  acceptedTerms: boolean;
}

/** What a signed-in account still has to do, or null when nothing. */
export function setupNeeds(
  user: Pick<User, 'app_metadata'> | null | undefined,
  record: SetupRecord | null,
): SetupNeeds | null {
  if (!user || !createdWithSocialProvider(user)) return null;
  const needs: SetupNeeds = {
    username: !record?.username || record.username.trim().length === 0,
    terms: !record?.acceptedTerms,
  };
  return needs.username || needs.terms ? needs : null;
}

/** Same limits as the email sign-up form and Profile (3-20 characters). */
export function validateUsername(value: string): string | null {
  const v = value.trim();
  if (v.length < 3) return 'Username must be at least 3 characters';
  if (v.length > 20) return 'Username must be 20 characters or fewer';
  return null;
}

function slug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '')
    .slice(0, 20);
}

/**
 * A starting suggestion for the username field, or '' when there's
 * nothing sensible. Apple's Hide My Email addresses are random strings,
 * so they're never used.
 */
export function suggestUsername(user: Pick<User, 'email' | 'user_metadata'> | null | undefined): string {
  const meta = user?.user_metadata ?? {};
  const email = typeof user?.email === 'string' ? user.email : '';
  const fromEmail = email && !/privaterelay\.appleid\.com$/i.test(email) ? slug(email.split('@')[0]) : '';
  if (fromEmail.length >= 3) return fromEmail;
  const name = typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : '';
  const fromName = slug(name);
  return fromName.length >= 3 ? fromName : '';
}

/**
 * `appleName` is the name Apple shared at sign-in, kept on the device only
 * (Apple never puts it in the token, and nothing is saved before setup).
 */
export function suggestDisplayName(user: Pick<User, 'user_metadata'> | null | undefined, appleName = ''): string {
  if (appleName.trim()) return appleName.trim().slice(0, 50);
  const meta = user?.user_metadata ?? {};
  const name = typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : '';
  return name.trim().slice(0, 50);
}

/**
 * Whether the setup screen may offer to remove this brand-new account
 * (for someone who meant to use an existing one). Only an account created
 * by Apple/Google that never finished setup, and that has no email
 * password sign-in attached, qualifies.
 */
export function canDiscardNewAccount(
  user: { app_metadata: User['app_metadata']; identities?: Array<{ provider: string }> } | null | undefined,
  needs: SetupNeeds | null,
): boolean {
  if (!user || !needs?.username || !createdWithSocialProvider(user)) return false;
  const providers: unknown = user.app_metadata?.providers;
  if (Array.isArray(providers) && providers.includes('email')) return false;
  if (user.identities?.some((identity) => identity.provider === 'email')) return false;
  return true;
}

/** PostgREST/Postgres codes for "that table or function doesn't exist (yet)". */
export function isMissingBackend(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return ['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code ?? '')
    || /could not find the (table|function)/i.test(error.message ?? '');
}
