// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createAppleClientSecret,
  decodeJwtPayload,
  readAppleConfig,
  revokeAppleAuthorization,
  sha256Hex,
  validateReauth,
  type AppleConfig,
} from '../supabase/functions/delete-account/apple';

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const fakeJwt = (claims: Record<string, unknown>) =>
  `${b64url(Buffer.from('{"alg":"RS256"}'))}.${b64url(Buffer.from(JSON.stringify(claims)))}.sig`;

async function testKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----`;
  return { pem, publicKey: pair.publicKey };
}

const NOW = 1_800_000_000;
const NONCE = 'a'.repeat(64);

async function config(): Promise<AppleConfig & { publicKey: CryptoKey }> {
  const { pem, publicKey } = await testKey();
  return {
    teamId: 'A7V4PN4DWK',
    keyId: 'KEY123',
    privateKeyPem: pem,
    allowedClientIds: ['com.afiyeat.app', 'com.afiyeat.web'],
    allowedRedirectUris: ['https://afiyeat.com/auth-callback.html'],
    publicKey,
  };
}

function appleFetch(opts: { token?: Record<string, unknown>; tokenStatus?: number; revokeStatus?: number; claims?: Record<string, unknown> } = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const form = new URLSearchParams(String(init?.body));
    if (url.endsWith('/auth/token')) {
      const claims = { iss: 'https://appleid.apple.com', aud: form.get('client_id'), sub: 'apple-sub-1', exp: NOW + 600, nonce: await sha256Hex(NONCE), ...opts.claims };
      const body = opts.token ?? { access_token: 'acc-tok', refresh_token: 'ref-tok', id_token: fakeJwt(claims) };
      return new Response(JSON.stringify(body), { status: opts.tokenStatus ?? 200 });
    }
    if (url.endsWith('/auth/revoke')) return new Response('', { status: opts.revokeStatus ?? 200 });
    throw new Error(`unexpected ${url}`);
  });
}

describe('client secret', () => {
  it('is an ES256 JWT for the given client, signed by the .p8 key, valid 5 minutes', async () => {
    const cfg = await config();
    const jwt = await createAppleClientSecret(cfg, 'com.afiyeat.app', NOW);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY123', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({
      iss: 'A7V4PN4DWK', iat: NOW, exp: NOW + 300, aud: 'https://appleid.apple.com', sub: 'com.afiyeat.app',
    });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, cfg.publicKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });
});

describe('configuration', () => {
  it('needs team, key id, key and at least one client id', () => {
    const env = { APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K', APPLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nAAA\\n-----END PRIVATE KEY-----', APPLE_CLIENT_IDS: 'com.afiyeat.app, com.afiyeat.web', APPLE_WEB_REDIRECT_URIS: 'https://afiyeat.com/auth-callback.html' } as Record<string, string>;
    const cfg = readAppleConfig((k) => env[k]);
    expect(cfg?.allowedClientIds).toEqual(['com.afiyeat.app', 'com.afiyeat.web']);
    expect(cfg?.privateKeyPem).toContain('\nAAA\n');
    expect(readAppleConfig((k) => ({ ...env, APPLE_CLIENT_IDS: '' })[k])).toBeNull();
    expect(readAppleConfig(() => undefined)).toBeNull();
  });

  it('validates the request before anything is sent to Apple', async () => {
    const cfg = await config();
    expect(validateReauth({ authorization_code: 'c', client_id: 'com.evil.app', nonce: NONCE }, cfg)).toBe('client_id not allowed');
    expect(validateReauth({ authorization_code: 'c', client_id: 'com.afiyeat.app', nonce: 'short' }, cfg)).toBe('nonce missing');
    expect(validateReauth({ authorization_code: '', client_id: 'com.afiyeat.app', nonce: NONCE }, cfg)).toBe('authorization_code missing');
    expect(validateReauth({ authorization_code: 'c', client_id: 'com.afiyeat.web', nonce: NONCE, redirect_uri: 'https://evil.example/cb' }, cfg)).toBe('redirect_uri not allowed');
    expect(validateReauth({ authorization_code: 'c', client_id: 'com.afiyeat.web', nonce: NONCE, redirect_uri: 'https://afiyeat.com/auth-callback.html' }, cfg)).toMatchObject({ client_id: 'com.afiyeat.web' });
    expect(validateReauth(null, cfg)).toBe('missing apple object');
  });
});

describe('revocation', () => {
  const reauth = { authorization_code: 'code-1', client_id: 'com.afiyeat.app', nonce: NONCE };

  it('exchanges the code, checks the identity, then revokes the refresh token with the same client', async () => {
    const cfg = await config();
    const fetchImpl = appleFetch();
    expect(await revokeAppleAuthorization(reauth, ['apple-sub-1'], cfg, fetchImpl, NOW)).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const tokenForm = new URLSearchParams(String(fetchImpl.mock.calls[0][1]?.body));
    expect(fetchImpl.mock.calls[0][0]).toBe('https://appleid.apple.com/auth/token');
    expect(Object.fromEntries(tokenForm)).toMatchObject({ client_id: 'com.afiyeat.app', code: 'code-1', grant_type: 'authorization_code' });
    expect(tokenForm.has('redirect_uri')).toBe(false);
    expect(decodeJwtPayload(tokenForm.get('client_secret')!)).toMatchObject({ sub: 'com.afiyeat.app' });
    const revokeForm = new URLSearchParams(String(fetchImpl.mock.calls[1][1]?.body));
    expect(fetchImpl.mock.calls[1][0]).toBe('https://appleid.apple.com/auth/revoke');
    expect(Object.fromEntries(revokeForm)).toMatchObject({ client_id: 'com.afiyeat.app', token: 'ref-tok', token_type_hint: 'refresh_token' });
  });

  it('falls back to the access token when Apple returns no refresh token', async () => {
    const cfg = await config();
    const claims = { iss: 'https://appleid.apple.com', aud: 'com.afiyeat.app', sub: 'apple-sub-1', nonce: await sha256Hex(NONCE) };
    const fetchImpl = appleFetch({ token: { access_token: 'acc-only', id_token: fakeJwt(claims) } });
    expect(await revokeAppleAuthorization(reauth, ['apple-sub-1'], cfg, fetchImpl, NOW)).toEqual({ ok: true });
    expect(Object.fromEntries(new URLSearchParams(String(fetchImpl.mock.calls[1][1]?.body)))).toMatchObject({ token: 'acc-only', token_type_hint: 'access_token' });
  });

  it('sends the website redirect URI when the code came from Sign in with Apple JS', async () => {
    const cfg = await config();
    const fetchImpl = appleFetch();
    await revokeAppleAuthorization({ ...reauth, client_id: 'com.afiyeat.web', redirect_uri: 'https://afiyeat.com/auth-callback.html' }, ['apple-sub-1'], cfg, fetchImpl, NOW);
    expect(new URLSearchParams(String(fetchImpl.mock.calls[0][1]?.body)).get('redirect_uri')).toBe('https://afiyeat.com/auth-callback.html');
  });

  it('an expired or reused code asks the person to confirm again, and revokes nothing', async () => {
    const cfg = await config();
    const fetchImpl = appleFetch({ tokenStatus: 400, token: { error: 'invalid_grant' } });
    expect(await revokeAppleAuthorization(reauth, ['apple-sub-1'], cfg, fetchImpl, NOW)).toMatchObject({ ok: false, error: 'apple_reauth_failed' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses another person's Apple account, a wrong nonce or audience", async () => {
    const cfg = await config();
    const other = appleFetch();
    expect(await revokeAppleAuthorization(reauth, ['someone-else'], cfg, other, NOW)).toMatchObject({ ok: false, error: 'apple_identity_mismatch' });
    expect(other).toHaveBeenCalledTimes(1);
    expect(await revokeAppleAuthorization(reauth, ['apple-sub-1'], cfg, appleFetch({ claims: { nonce: 'replayed' } }), NOW)).toMatchObject({ error: 'apple_reauth_failed', detail: 'nonce mismatch' });
    expect(await revokeAppleAuthorization(reauth, ['apple-sub-1'], cfg, appleFetch({ claims: { aud: 'com.other' } }), NOW)).toMatchObject({ error: 'apple_reauth_failed', detail: 'unexpected audience' });
    expect(await revokeAppleAuthorization(reauth, ['apple-sub-1'], cfg, appleFetch({ claims: { iss: 'https://evil' } }), NOW)).toMatchObject({ detail: 'unexpected issuer' });
  });

  it('reports Apple being down as a revoke failure', async () => {
    const cfg = await config();
    expect(await revokeAppleAuthorization(reauth, ['apple-sub-1'], cfg, appleFetch({ revokeStatus: 503 }), NOW)).toMatchObject({ ok: false, error: 'apple_revoke_failed' });
    const down = vi.fn(async () => { throw new TypeError('fetch failed'); });
    expect(await revokeAppleAuthorization(reauth, ['apple-sub-1'], cfg, down, NOW)).toMatchObject({ ok: false, error: 'apple_revoke_failed' });
  });

  it('a key that cannot sign is reported as not configured', async () => {
    const cfg = { ...(await config()), privateKeyPem: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----' };
    const fetchImpl = appleFetch();
    expect(await revokeAppleAuthorization(reauth, ['apple-sub-1'], cfg, fetchImpl, NOW)).toMatchObject({ ok: false, error: 'apple_not_configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
