import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  setup: 'needed' as string,
  user: { id: 'u1', identities: [] as Array<Record<string, unknown>> } as Record<string, unknown> | null,
  rpc: vi.fn(async () => ({ error: null })),
  update: vi.fn(),
  init: vi.fn(async (onToken: (t: string) => Promise<void>) => { await onToken('device-token'); }),
  signOut: vi.fn(async () => undefined),
  credentialState: vi.fn(async () => ({ state: 'authorized' })),
  resume: [] as Array<() => void>,
  native: true,
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: m.user, signOut: m.signOut }) }));
vi.mock('@/contexts/AccountSetupContext', () => ({ useAccountSetup: () => ({ status: m.setup }) }));
vi.mock('@/lib/native', () => ({ isNative: () => m.native, initPushNotifications: (cb: (t: string) => Promise<void>) => m.init(cb) }));
vi.mock('@capacitor/core', async (orig) => ({ ...(await orig<object>()), Capacitor: { getPlatform: () => 'ios' } }));
vi.mock('@capacitor/app', () => ({
  App: { addListener: (_e: string, cb: () => void) => { m.resume.push(cb); return Promise.resolve({ remove: vi.fn() }); } },
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => m.rpc(...(args as [])),
    from: () => ({ update: (v: unknown) => { m.update(v); return { eq: async () => ({ error: null }) }; } }),
  },
}));
vi.mock('@/lib/socialAuth/nativeAuth', async (orig) => ({
  ...(await orig<object>()),
  AfiyeatAuth: { getAppleCredentialState: (o: unknown) => m.credentialState(o as never) },
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { PushNotificationManager, registerForPush } from '@/components/shared/PushNotificationManager';
import { AppleCredentialWatcher } from '@/components/auth/AppleCredentialWatcher';

beforeEach(() => {
  vi.clearAllMocks();
  m.setup = 'needed';
  m.native = true;
  m.user = { id: 'u1', identities: [] };
  m.resume = [];
});

describe('nothing is registered or written before setup is finished', () => {
  it('no push token and no timezone write while a new Apple/Google account is in setup', async () => {
    render(<PushNotificationManager />);
    await new Promise((r) => setTimeout(r, 20));
    expect(m.init).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    // Other paths (e.g. the in-app push prompt) can't register either.
    await registerForPush({ prompt: true });
    expect(m.init).not.toHaveBeenCalled();
  });

  it('registers and writes the timezone once setup is complete (as for every email account)', async () => {
    m.setup = 'complete';
    render(<PushNotificationManager />);
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('claim_device_token', { p_token: 'device-token', p_platform: 'ios' }));
    expect(m.update).toHaveBeenCalledWith({ timezone: expect.any(String) });
  });
});

describe('Sign in with Apple turned off in Settings (TN3194)', () => {
  const appleUser = { id: 'u1', identities: [{ provider: 'apple', id: 'apple-sub', identity_data: { sub: 'apple-sub' } }] };

  it('signs out when Apple reports the credential revoked, on launch or on return to the app', async () => {
    m.user = appleUser;
    render(<AppleCredentialWatcher />);
    await waitFor(() => expect(m.credentialState).toHaveBeenCalledWith({ user: 'apple-sub' }));
    expect(m.signOut).not.toHaveBeenCalled();
    m.credentialState.mockResolvedValueOnce({ state: 'revoked' });
    m.resume.forEach((cb) => cb());
    await waitFor(() => expect(m.signOut).toHaveBeenCalledTimes(1));
  });

  it('"not found" (a different Apple Account on this iPhone) does not sign out', async () => {
    m.user = appleUser;
    m.credentialState.mockResolvedValue({ state: 'notFound' });
    render(<AppleCredentialWatcher />);
    await waitFor(() => expect(m.credentialState).toHaveBeenCalled());
    expect(m.signOut).not.toHaveBeenCalled();
  });

  it('does nothing for accounts without Apple, or on the website', async () => {
    render(<AppleCredentialWatcher />);
    m.user = appleUser;
    m.native = false;
    render(<AppleCredentialWatcher />);
    await new Promise((r) => setTimeout(r, 20));
    expect(m.credentialState).not.toHaveBeenCalled();
  });
});
