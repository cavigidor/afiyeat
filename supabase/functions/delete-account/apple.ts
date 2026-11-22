// Sign in with Apple token revocation for account deletion (App Review guideline 5.1.1(v);
// Apple TN3194 "Handling account deletions and revoking tokens for Sign in with Apple").
//
// Afiyeat never stores Apple tokens. When an account that has an Apple identity is deleted,
// the app asks the person to confirm with Apple once more and sends the fresh, single-use
// authorization code here. This module then:
//   1. builds a short-lived client secret (ES256 JWT signed with the team's .p8 key);
//   2. exchanges the code at https://appleid.apple.com/auth/token;
//   3. checks the returned identity token belongs to THIS account's Apple identity
//      (issuer, audience = client id, subject, and the one-time nonce);
//   4. revokes the refresh token (or the access token if no refresh token came back) at
//      https://appleid.apple.com/auth/revoke with the same client id.
//
// Dependency-free (Web Crypto + fetch only) so the same file runs in the Deno Edge Function
// and in the Node test suite. Never logs or returns a token or the key.

export interface AppleConfig {
  teamId: string;
  keyId: string;
  /** Contents of the .p8 file (PKCS#8 PEM). Edge Function secret APPLE_PRIVATE_KEY. */
  privateKeyPem: string;
  /** Client ids allowed to exchange codes: the bundle id(s) and the web Services ID. */
  allowedClientIds: string[];
  /** Redirect URIs allowed for codes from Sign in with Apple JS on the website. */
  allowedRedirectUris: string[];
}

export interface AppleReauth {
  authorization_code: string;
  client_id: string;
  /** Raw nonce the app generated; Apple's identity token carries its SHA-256 (hex). */
  nonce: string;
  /** Only for codes from Sign in with Apple JS (website); must match the authorization. */
  redirect_uri?: string;
}

export type AppleRevocationError =
  | 'apple_not_configured'
  | 'apple_request_invalid'
  | 'apple_reauth_failed'
  | 'apple_identity_mismatch'
  | 'apple_revoke_failed';

export type AppleRevocationResult = { ok: true } | { ok: false; error: AppleRevocationError; detail: string };

const APPLE_ISSUER = 'https://appleid.apple.com';
const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const CLIENT_SECRET_TTL_S = 300;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
type Env = (name: string) => string | undefined;

const list = (value: string | undefined) =>
  (value ?? '').split(',').map((v) => v.trim()).filter(Boolean);

/**
 * Reads the Apple settings from Edge Function secrets. Returns null when any required one is
 * missing, which the handler reports as "not configured" instead of failing silently.
 */
export function readAppleConfig(env: Env): AppleConfig | null {
  const teamId = env('APPLE_TEAM_ID')?.trim();
  const keyId = env('APPLE_KEY_ID')?.trim();
  const privateKeyPem = env('APPLE_PRIVATE_KEY')?.replace(/\\n/g, '\n').trim();
  const allowedClientIds = list(env('APPLE_CLIENT_IDS'));
  if (!teamId || !keyId || !privateKeyPem || allowedClientIds.length === 0) return null;
  const allowedRedirectUris = list(env('APPLE_WEB_REDIRECT_URIS'));
  return { teamId, keyId, privateKeyPem, allowedClientIds, allowedRedirectUris };
}

const b64url = (bytes: Uint8Array) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlJson = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  const bin = atob(body);
  const out = new ArrayBuffer(bin.length);
  const view = new Uint8Array(out);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return out;
}

/** Apple's client secret: ES256 JWT, iss = team, sub = client id, aud = Apple, valid 5 minutes. */
export async function createAppleClientSecret(
  config: Pick<AppleConfig, 'teamId' | 'keyId' | 'privateKeyPem'>,
  clientId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(config.privateKeyPem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const header = b64urlJson({ alg: 'ES256', kid: config.keyId, typ: 'JWT' });
  const claims = b64urlJson({
    iss: config.teamId,
    iat: nowSeconds,
    exp: nowSeconds + CLIENT_SECRET_TTL_S,
    aud: APPLE_ISSUER,
    sub: clientId,
  });
  const input = `${header}.${claims}`;
  // Web Crypto returns the raw r||s signature, which is exactly what JWS ES256 uses.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input)),
  );
  return `${input}.${b64url(signature)}`;
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const value = JSON.parse(json);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Validates the request body's `apple` object before anything is sent to Apple. */
export function validateReauth(input: unknown, config: AppleConfig): AppleReauth | string {
  const value = input as Partial<AppleReauth> | null;
  if (!value || typeof value !== 'object') return 'missing apple object';
  const code = typeof value.authorization_code === 'string' ? value.authorization_code.trim() : '';
  const clientId = typeof value.client_id === 'string' ? value.client_id.trim() : '';
  const nonce = typeof value.nonce === 'string' ? value.nonce : '';
  if (!code || code.length > 2048) return 'authorization_code missing';
  if (!config.allowedClientIds.includes(clientId)) return 'client_id not allowed';
  if (nonce.length < 32 || nonce.length > 256) return 'nonce missing';
  let redirectUri: string | undefined;
  if (value.redirect_uri !== undefined) {
    if (typeof value.redirect_uri !== 'string' || !config.allowedRedirectUris.includes(value.redirect_uri)) {
      return 'redirect_uri not allowed';
    }
    redirectUri = value.redirect_uri;
  }
  return { authorization_code: code, client_id: clientId, nonce, redirect_uri: redirectUri };
}

/**
 * Exchanges the code, checks it belongs to one of `appleSubjects` (the account's Apple
 * identity), then revokes. Nothing is retried here; the caller decides what a failure means.
 */
export async function revokeAppleAuthorization(
  reauth: AppleReauth,
  appleSubjects: string[],
  config: AppleConfig,
  fetchImpl: Fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<AppleRevocationResult> {
  let clientSecret: string;
  try {
    clientSecret = await createAppleClientSecret(config, reauth.client_id, nowSeconds);
  } catch {
    return { ok: false, error: 'apple_not_configured', detail: 'APPLE_PRIVATE_KEY could not be used to sign' };
  }

  // 1. Exchange the single-use code.
  const form = new URLSearchParams({
    client_id: reauth.client_id,
    client_secret: clientSecret,
    code: reauth.authorization_code,
    grant_type: 'authorization_code',
  });
  if (reauth.redirect_uri) form.set('redirect_uri', reauth.redirect_uri);
  let tokens: { access_token?: string; refresh_token?: string; id_token?: string; error?: string };
  try {
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    tokens = await res.json().catch(() => ({}));
    if (!res.ok) {
      // invalid_grant = expired or already-used code: the person needs to confirm again.
      return { ok: false, error: 'apple_reauth_failed', detail: `token endpoint ${res.status} ${tokens.error ?? ''}`.trim() };
    }
  } catch (err) {
    return { ok: false, error: 'apple_revoke_failed', detail: `token endpoint unreachable: ${String(err)}` };
  }

  // 2. The tokens must be for this account's Apple identity, this client and this attempt.
  const claims = tokens.id_token ? decodeJwtPayload(tokens.id_token) : null;
  if (!claims) return { ok: false, error: 'apple_reauth_failed', detail: 'no identity token in token response' };
  const expectedNonce = await sha256Hex(reauth.nonce);
  if (claims.iss !== APPLE_ISSUER) return { ok: false, error: 'apple_reauth_failed', detail: 'unexpected issuer' };
  if (claims.aud !== reauth.client_id) return { ok: false, error: 'apple_reauth_failed', detail: 'unexpected audience' };
  if (typeof claims.exp === 'number' && claims.exp < nowSeconds - 60) {
    return { ok: false, error: 'apple_reauth_failed', detail: 'identity token expired' };
  }
  if (claims.nonce !== expectedNonce) return { ok: false, error: 'apple_reauth_failed', detail: 'nonce mismatch' };
  if (typeof claims.sub !== 'string' || !appleSubjects.includes(claims.sub)) {
    return { ok: false, error: 'apple_identity_mismatch', detail: 'Apple account is not the one linked to this Afiyeat account' };
  }

  // 3. Revoke. Apple answers 200 with an empty body on success.
  const token = tokens.refresh_token ?? tokens.access_token;
  if (!token) return { ok: false, error: 'apple_reauth_failed', detail: 'no token to revoke in token response' };
  try {
    const res = await fetchImpl(REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: reauth.client_id,
        client_secret: clientSecret,
        token,
        token_type_hint: tokens.refresh_token ? 'refresh_token' : 'access_token',
      }).toString(),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({} as { error?: string }));
      return { ok: false, error: 'apple_revoke_failed', detail: `revoke endpoint ${res.status} ${body.error ?? ''}`.trim() };
    }
  } catch (err) {
    return { ok: false, error: 'apple_revoke_failed', detail: `revoke endpoint unreachable: ${String(err)}` };
  }
  return { ok: true };
}
