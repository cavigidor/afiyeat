import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appleWebReauthorize } from '@/lib/socialAuth/appleWeb';
import { parseReadiness, fetchEnabledProviders } from '@/lib/socialAuth/providers';
import { SocialAuthCancelled } from '@/lib/socialAuth/callback';

async function sha256Hex(text: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('Sign in with Apple JS (website, deletion only)', () => {
  let init: ReturnType<typeof vi.fn>;
  let signIn: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    init = vi.fn();
    signIn = vi.fn();
    window.AppleID = { auth: { init, signIn } };
  });

  it('asks for a popup code for the Services ID, with the hashed nonce and a state it checks', async () => {
    signIn.mockImplementation(async () => ({ authorization: { code: 'web-code', state: init.mock.calls[0][0].state } }));
    const result = await appleWebReauthorize('raw-nonce-'.repeat(4));
    expect(init).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'com.afiyeat.web',
      redirectURI: `${window.location.origin}/auth-callback.html`,
      nonce: await sha256Hex('raw-nonce-'.repeat(4)),
      usePopup: true,
      scope: '',
    }));
    expect(result).toEqual({ code: 'web-code', clientId: 'com.afiyeat.web', redirectUri: `${window.location.origin}/auth-callback.html` });
  });

  it('rejects a response whose state does not match', async () => {
    signIn.mockResolvedValue({ authorization: { code: 'c', state: 'someone-elses' } });
    await expect(appleWebReauthorize('x'.repeat(40))).rejects.toMatchObject({ code: 'FAILED' });
  });

  it('closing the popup is a cancellation', async () => {
    signIn.mockRejectedValue({ error: 'popup_closed_by_user' });
    await expect(appleWebReauthorize('x'.repeat(40))).rejects.toBeInstanceOf(SocialAuthCancelled);
  });
});

describe('buttons wait for the backend', () => {
  it('only a "vN" answer from social_sign_in_ready counts', () => {
    expect(parseReadiness(200, 'v1')).toBe(true);
    expect(parseReadiness(404, { code: 'PGRST202' })).toBe(false);
    expect(parseReadiness(200, null)).toBe(false);
    expect(parseReadiness(200, 'yes')).toBe(false);
  });

  it('providers switched on but the SQL not applied: no buttons', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/auth/v1/settings')
      ? new Response(JSON.stringify({ external: { apple: true, google: true } }), { status: 200 })
      : new Response(JSON.stringify({ code: 'PGRST202', message: 'Could not find the function' }), { status: 404 })));
    expect(await fetchEnabledProviders()).toEqual({ apple: false, google: false });
  });

  it('both in place: buttons', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/auth/v1/settings')
      ? new Response(JSON.stringify({ external: { apple: true, google: false } }), { status: 200 })
      : new Response(JSON.stringify('v1'), { status: 200 })));
    expect(await fetchEnabledProviders()).toEqual({ apple: true, google: false });
  });
});
