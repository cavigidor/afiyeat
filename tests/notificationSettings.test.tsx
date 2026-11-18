import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Fakes: Capacitor (native/web, iOS permission, registration), the app
// lifecycle, and the tables this code touches.
// ---------------------------------------------------------------------------
type Consent = { user_id: string; push_kind: string; consent_version: string };
const db = vi.hoisted(() => ({
  consents: [] as Consent[],
  tokens: [] as { user_id: string; token: string }[],
  tableMissing: false,
  failWrites: false,
  profileUpdates: [] as { timezone: string; user_id: string }[],
}));
const ios = vi.hoisted(() => ({
  native: true,
  permission: 'prompt' as 'prompt' | 'granted' | 'denied',
  answer: 'granted' as 'granted' | 'denied',
  requestCalls: 0,
  registerCalls: 0,
  token: 'apns-token-1',
  listeners: {} as Record<string, (arg: unknown) => unknown>,
  appStateListeners: [] as ((s: { isActive: boolean }) => void)[],
}));
const auth = vi.hoisted(() => ({ userId: 'user-me' as string | null }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const settings = vi.hoisted(() => ({ opened: 0 }));

vi.mock('sonner', () => ({ toast }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => ios.native, getPlatform: () => (ios.native ? 'ios' : 'web') },
}));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    checkPermissions: async () => ({ receive: ios.permission }),
    requestPermissions: async () => {
      ios.requestCalls += 1;
      ios.permission = ios.answer;
      return { receive: ios.permission };
    },
    removeAllListeners: async () => {
      ios.listeners = {};
    },
    addListener: async (name: string, fn: (arg: unknown) => unknown) => {
      ios.listeners[name] = fn;
      return { remove: async () => {} };
    },
    register: async () => {
      ios.registerCalls += 1;
      await ios.listeners.registration?.({ value: ios.token });
    },
  },
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (_name: string, fn: (s: { isActive: boolean }) => void) => {
      ios.appStateListeners.push(fn);
      return {
        remove: async () => {
          ios.appStateListeners = ios.appStateListeners.filter((l) => l !== fn);
        },
      };
    },
  },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: auth.userId ? { id: auth.userId } : null }),
}));
vi.mock('@/lib/pushPermission', async (orig) => ({
  ...(await orig<typeof import('@/lib/pushPermission')>()),
  openIPhoneSettings: () => {
    settings.opened += 1;
  },
}));
vi.mock('@/integrations/supabase/client', () => {
  const missing = {
    code: 'PGRST205',
    message: "Could not find the table 'public.notification_consents' in the schema cache",
  };
  const writeError = () => (db.failWrites ? { message: 'network down' } : null);
  return {
    supabase: {
      rpc: vi.fn(async (fn: string, args: { p_token: string }) => {
        if (fn !== 'claim_device_token') throw new Error(`unexpected rpc ${fn}`);
        // Same as the real function: the token belongs to whoever is signed in.
        db.tokens = db.tokens.filter((t) => t.token !== args.p_token);
        db.tokens.push({ user_id: auth.userId!, token: args.p_token });
        return { error: null };
      }),
      from(table: string) {
        if (table === 'profiles') {
          return {
            update: (values: { timezone: string }) => ({
              eq: (_c: string, userId: string) => {
                db.profileUpdates.push({ ...values, user_id: userId });
                return Promise.resolve({ error: null });
              },
            }),
          };
        }
        if (table === 'device_tokens') {
          return {
            delete: () => ({
              eq: async (_c: string, token: string) => {
                // RLS: only the signed-in user's own row can be deleted.
                db.tokens = db.tokens.filter((t) => !(t.token === token && t.user_id === auth.userId));
                return { error: null };
              },
            }),
          };
        }
        if (table !== 'notification_consents') throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            eq: async (_c: string, userId: string) =>
              db.tableMissing
                ? { data: null, error: missing }
                : { data: db.consents.filter((r) => r.user_id === userId), error: null },
          }),
          upsert: async (rows: Consent[]) => {
            const error = writeError();
            if (!error) {
              for (const row of rows) {
                if (!db.consents.some((r) => r.user_id === row.user_id && r.push_kind === row.push_kind)) {
                  db.consents.push(row);
                }
              }
            }
            return { error };
          },
          delete: () => ({
            eq: (_c: string, userId: string) => ({
              in: async (_c2: string, kinds: string[]) => {
                const error = writeError();
                if (!error) {
                  db.consents = db.consents.filter((r) => !(r.user_id === userId && kinds.includes(r.push_kind)));
                }
                return { error };
              },
            }),
          }),
        };
      },
    },
  };
});

import { NotificationSettingsCard } from '@/components/shared/NotificationSettingsCard';
import { PushNotificationManager, getCurrentDeviceToken } from '@/components/shared/PushNotificationManager';
import { DAILY_PUSH_CONSENT_VERSION } from '@/lib/notificationPreferences';

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
const switchFor = (name: RegExp) => screen.getByRole('switch', { name });
const checked = (name: RegExp) => switchFor(name).getAttribute('aria-checked') === 'true';

const ME = 'user-me';
const OTHER = 'user-other';

beforeEach(() => {
  localStorage.clear();
  db.consents = [{ user_id: OTHER, push_kind: 'morning_explore', consent_version: 'x' }];
  db.tokens = [];
  db.tableMissing = false;
  db.failWrites = false;
  db.profileUpdates = [];
  Object.assign(ios, {
    native: true, permission: 'prompt', answer: 'granted', requestCalls: 0, registerCalls: 0,
    token: 'apns-token-1', listeners: {}, appStateListeners: [],
  });
  auth.userId = ME;
  settings.opened = 0;
  toast.error.mockReset();
});

// ---------------------------------------------------------------------------
describe('first launch: Apple notification dialog', () => {
  it('shows Apple\'s dialog once on first launch, with no Afiyeat screen of its own', async () => {
    const { container } = wrap(<PushNotificationManager />);
    await settle();
    expect(ios.requestCalls).toBe(1);
    expect(container.textContent).toBe('');
  });

  it('asks even before anyone has signed in', async () => {
    auth.userId = null;
    wrap(<PushNotificationManager />);
    await settle();
    expect(ios.requestCalls).toBe(1);
    expect(ios.registerCalls).toBe(0); // registers once someone signs in
  });

  it('never asks again on later launches, whatever iOS reports', async () => {
    ios.answer = 'denied';
    wrap(<PushNotificationManager />).unmount();
    await settle();
    expect(ios.requestCalls).toBe(1);

    ios.permission = 'prompt'; // even if iOS somehow still says "not decided"
    wrap(<PushNotificationManager />);
    await settle();
    expect(ios.requestCalls).toBe(1);
  });

  it('Allow: registers this iPhone for the signed-in account', async () => {
    wrap(<PushNotificationManager />);
    await settle();
    expect(ios.registerCalls).toBe(1);
    expect(db.tokens).toEqual([{ user_id: ME, token: 'apns-token-1' }]);
    expect(getCurrentDeviceToken()).toBe('apns-token-1');
  });

  it("Don't Allow: never registers, nothing is stored, the app carries on", async () => {
    ios.answer = 'denied';
    wrap(<PushNotificationManager />);
    await settle();
    expect(ios.registerCalls).toBe(0);
    expect(db.tokens).toEqual([]);
  });

  it('does nothing on the website', async () => {
    ios.native = false;
    wrap(<PushNotificationManager />);
    await settle();
    expect(ios.requestCalls).toBe(0);
    expect(ios.registerCalls).toBe(0);
  });
});

describe('registration follows the current permission', () => {
  it('a token registered earlier is removed once notifications are turned off in iPhone Settings', async () => {
    ios.permission = 'granted';
    wrap(<PushNotificationManager />);
    await settle();
    expect(db.tokens).toHaveLength(1);

    ios.permission = 'denied'; // turned off in Settings while the app was in the background
    await act(async () => ios.appStateListeners.forEach((l) => l({ isActive: true })));
    await settle();
    expect(db.tokens).toEqual([]);
    expect(getCurrentDeviceToken()).toBeNull();
  });

  it('removes a stale token on the next launch too (permission off, old token still saved)', async () => {
    localStorage.setItem('afiyeat.push_permission_asked', 'x');
    localStorage.setItem('afiyeat.push_device_token', 'old-token');
    db.tokens = [{ user_id: ME, token: 'old-token' }];
    ios.permission = 'denied';
    wrap(<PushNotificationManager />);
    await settle();
    expect(db.tokens).toEqual([]);
  });

  it('turning notifications back on in Settings registers again on return to the app', async () => {
    ios.answer = 'denied';
    wrap(<PushNotificationManager />);
    await settle();
    expect(db.tokens).toEqual([]);
    ios.permission = 'granted';
    await act(async () => ios.appStateListeners.forEach((l) => l({ isActive: true })));
    await settle();
    expect(db.tokens).toEqual([{ user_id: ME, token: 'apns-token-1' }]);
  });

  it('account switching on one phone: the token moves to the account now signed in', async () => {
    ios.permission = 'granted';
    const view = wrap(<PushNotificationManager />);
    await settle();
    expect(db.tokens).toEqual([{ user_id: ME, token: 'apns-token-1' }]);

    auth.userId = OTHER;
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PushNotificationManager />
      </QueryClientProvider>,
    );
    await settle();
    expect(db.tokens).toEqual([{ user_id: OTHER, token: 'apns-token-1' }]);
  });

  it('two devices on one account keep separate tokens', async () => {
    db.tokens = [{ user_id: ME, token: 'other-iphone' }];
    ios.permission = 'granted';
    wrap(<PushNotificationManager />);
    await settle();
    expect(db.tokens.map((t) => t.token).sort()).toEqual(['apns-token-1', 'other-iphone']);
  });
});

// ---------------------------------------------------------------------------
describe('Profile > Notifications: explicit opt-in', () => {
  beforeEach(() => {
    ios.permission = 'granted';
  });

  it('is off by default (existing and new accounts) and shows the consent wording', async () => {
    wrap(<NotificationSettingsCard />);
    await waitFor(() => expect(switchFor(/Daily ideas/)).toBeTruthy());
    expect(checked(/Daily ideas/)).toBe(false);
    expect(screen.getByText(/Yes, send me up to three Afiyeat notifications a day/)).toBeTruthy();
    expect(screen.queryByRole('switch', { name: /Explore your city/ })).toBeNull();
  });

  it('opting in records consent for all three, with the wording version; then each can be turned off alone', async () => {
    wrap(<NotificationSettingsCard />);
    await waitFor(() => expect(switchFor(/Daily ideas/)).toBeTruthy());

    fireEvent.click(switchFor(/Daily ideas/));
    await waitFor(() => expect(db.consents.filter((r) => r.user_id === ME)).toHaveLength(3));
    expect(db.consents.filter((r) => r.user_id === ME).every((r) => r.consent_version === DAILY_PUSH_CONSENT_VERSION)).toBe(true);
    expect(checked(/Good morning fun fact/) && checked(/Explore your city/) && checked(/Evening exploring/)).toBe(true);
    expect(screen.getByText(/7 AM/)).toBeTruthy();
    expect(screen.getByText(/8 AM/)).toBeTruthy();
    expect(screen.getByText(/5 PM/)).toBeTruthy();

    fireEvent.click(switchFor(/Explore your city/));
    await waitFor(() =>
      expect(db.consents.filter((r) => r.user_id === ME).map((r) => r.push_kind).sort()).toEqual([
        'evening_explore',
        'good_morning_fun_fact',
      ]),
    );
    expect(checked(/Daily ideas/)).toBe(true);
    // Someone else's consent is untouched.
    expect(db.consents).toContainEqual({ user_id: OTHER, push_kind: 'morning_explore', consent_version: 'x' });
  });

  it('switching Daily ideas off withdraws all of it', async () => {
    db.consents.push(
      { user_id: ME, push_kind: 'good_morning_fun_fact', consent_version: 'v' },
      { user_id: ME, push_kind: 'evening_explore', consent_version: 'v' },
    );
    wrap(<NotificationSettingsCard />);
    await waitFor(() => expect(checked(/Daily ideas/)).toBe(true));
    fireEvent.click(switchFor(/Daily ideas/));
    await waitFor(() => expect(db.consents.filter((r) => r.user_id === ME)).toHaveLength(0));
    expect(screen.queryByRole('switch', { name: /Evening exploring/ })).toBeNull();
  });

  it('a failed save puts the switch back and says so', async () => {
    db.failWrites = true;
    wrap(<NotificationSettingsCard />);
    await waitFor(() => expect(switchFor(/Daily ideas/)).toBeTruthy());
    fireEvent.click(switchFor(/Daily ideas/));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(checked(/Daily ideas/)).toBe(false);
  });

  it('is hidden until the database has the notification update', async () => {
    db.tableMissing = true;
    const { container } = wrap(<NotificationSettingsCard />);
    await settle();
    expect(container.textContent).toBe('');
  });

  it('notifications off on this iPhone: says so and offers iPhone Settings, never Apple\'s dialog', async () => {
    ios.permission = 'denied';
    wrap(<NotificationSettingsCard />);
    await waitFor(() => expect(screen.getByText(/Notifications are off for Afiyeat on this iPhone/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Open iPhone Settings' }));
    expect(settings.opened).toBe(1);
    expect(ios.requestCalls).toBe(0);
  });

  it('never asked on this iPhone: offers Apple\'s dialog, once', async () => {
    ios.permission = 'prompt';
    wrap(<NotificationSettingsCard />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Allow notifications' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Allow notifications' }));
    await settle();
    expect(ios.requestCalls).toBe(1);
    expect(db.tokens).toEqual([{ user_id: ME, token: 'apns-token-1' }]);
  });
});

// ---------------------------------------------------------------------------
describe('saved timezone', () => {
  it('is saved on sign-in, and again on returning to the app only if it changed', async () => {
    ios.native = false;
    let tz = 'America/Chicago';
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () => ({ resolvedOptions: () => ({ timeZone: tz }) }) as unknown as Intl.DateTimeFormat,
    );
    wrap(<PushNotificationManager />);
    await waitFor(() => expect(db.profileUpdates).toEqual([{ timezone: 'America/Chicago', user_id: ME }]));

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(db.profileUpdates).toHaveLength(1);

    tz = 'Europe/Istanbul';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(db.profileUpdates.at(-1)).toEqual({ timezone: 'Europe/Istanbul', user_id: ME }));
    expect(db.profileUpdates).toHaveLength(2);
    spy.mockRestore();
  });
});
