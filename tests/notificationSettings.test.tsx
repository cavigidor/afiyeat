import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

type OptOut = { user_id: string; push_kind: string };
const db = vi.hoisted(() => ({
  optOuts: [] as OptOut[],
  tableMissing: false,
  failWrites: false,
  profileUpdates: [] as { timezone: string; user_id: string }[],
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const native = vi.hoisted(() => ({
  isNative: vi.fn(() => false),
  getPushPermission: vi.fn(async () => 'granted'),
  initPushNotifications: vi.fn(),
}));

const ME = 'user-me';
const OTHER = 'user-other';

vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/native', () => native);
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: ME } }) }));
vi.mock('@/integrations/supabase/client', () => {
  const missing = {
    code: 'PGRST205',
    message: "Could not find the table 'public.notification_opt_outs' in the schema cache",
  };
  const writeError = () => (db.failWrites ? { message: 'network down' } : null);
  return {
    supabase: {
      rpc: vi.fn(async () => ({ error: null })),
      from(table: string) {
        if (table === 'profiles') {
          return {
            update: (values: { timezone: string }) => ({
              eq: (_col: string, userId: string) => {
                db.profileUpdates.push({ ...values, user_id: userId });
                return Promise.resolve({ error: null });
              },
            }),
          };
        }
        if (table !== 'notification_opt_outs') throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            eq: async (_col: string, userId: string) =>
              db.tableMissing
                ? { data: null, error: missing }
                : { data: db.optOuts.filter((r) => r.user_id === userId), error: null },
          }),
          delete: () => ({
            eq: (_c1: string, userId: string) => ({
              eq: async (_c2: string, kind: string) => {
                const error = writeError();
                if (!error) db.optOuts = db.optOuts.filter((r) => !(r.user_id === userId && r.push_kind === kind));
                return { error };
              },
            }),
          }),
          upsert: async (row: OptOut) => {
            const error = writeError();
            if (!error && !db.optOuts.some((r) => r.user_id === row.user_id && r.push_kind === row.push_kind)) {
              db.optOuts.push(row);
            }
            return { error };
          },
        };
      },
    },
  };
});

import { NotificationSettingsCard } from '@/components/shared/NotificationSettingsCard';
import { PushNotificationManager } from '@/components/shared/PushNotificationManager';

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const switchFor = (name: RegExp) => screen.getByRole('switch', { name });

beforeEach(() => {
  db.optOuts = [{ user_id: OTHER, push_kind: 'morning_explore' }];
  db.tableMissing = false;
  db.failWrites = false;
  db.profileUpdates = [];
  toast.error.mockReset();
  native.getPushPermission.mockResolvedValue('granted');
});

describe('Profile > Notifications', () => {
  it('shows the three daily pushes, all on by default', async () => {
    wrap(<NotificationSettingsCard />);
    await waitFor(() => expect(switchFor(/Good morning fun fact/)).toBeTruthy());
    for (const name of [/Good morning fun fact/, /Explore your city/, /Evening exploring/]) {
      expect(switchFor(name).getAttribute('aria-checked')).toBe('true');
    }
    expect(screen.getByText(/7 AM/)).toBeTruthy();
    expect(screen.getByText(/8 AM/)).toBeTruthy();
    expect(screen.getByText(/5 PM/)).toBeTruthy();
  });

  it('switching one off saves an opt-out for that push only, and switching it back on removes it', async () => {
    wrap(<NotificationSettingsCard />);
    await waitFor(() => expect(switchFor(/Explore your city/)).toBeTruthy());

    fireEvent.click(switchFor(/Explore your city/));
    await waitFor(() =>
      expect(db.optOuts).toContainEqual({ user_id: ME, push_kind: 'morning_explore' }),
    );
    expect(db.optOuts.filter((r) => r.user_id === ME)).toHaveLength(1);
    expect(switchFor(/Explore your city/).getAttribute('aria-checked')).toBe('false');
    expect(switchFor(/Good morning fun fact/).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(switchFor(/Explore your city/));
    await waitFor(() => expect(db.optOuts.filter((r) => r.user_id === ME)).toHaveLength(0));
    // Another user's opt-out is untouched.
    expect(db.optOuts).toContainEqual({ user_id: OTHER, push_kind: 'morning_explore' });
  });

  it('a failed save puts the switch back and says so', async () => {
    db.failWrites = true;
    wrap(<NotificationSettingsCard />);
    await waitFor(() => expect(switchFor(/Evening exploring/)).toBeTruthy());
    fireEvent.click(switchFor(/Evening exploring/));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(switchFor(/Evening exploring/).getAttribute('aria-checked')).toBe('true');
  });

  it('is hidden until the database has the notification update', async () => {
    db.tableMissing = true;
    const { container } = wrap(<NotificationSettingsCard />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.textContent).toBe('');
  });

  it('says so when notifications are off in iPhone Settings', async () => {
    native.getPushPermission.mockResolvedValue('denied');
    wrap(<NotificationSettingsCard />);
    await waitFor(() => expect(screen.getByText(/off for Afiyeat in your iPhone Settings/)).toBeTruthy());
  });
});

describe('saved timezone', () => {
  it('is saved on sign-in, and again on returning to the app only if it changed', async () => {
    let tz = 'America/Chicago';
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () => ({ resolvedOptions: () => ({ timeZone: tz }) }) as unknown as Intl.DateTimeFormat,
    );
    wrap(<PushNotificationManager />);
    await waitFor(() => expect(db.profileUpdates).toEqual([{ timezone: 'America/Chicago', user_id: ME }]));

    // Back to the app, same place: no write.
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(db.profileUpdates).toHaveLength(1);

    // Back to the app after flying to Istanbul: saved.
    tz = 'Europe/Istanbul';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(db.profileUpdates.at(-1)).toEqual({ timezone: 'Europe/Istanbul', user_id: ME }));
    expect(db.profileUpdates).toHaveLength(2);
  });
});
