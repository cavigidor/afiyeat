import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Radix's Checkbox measures itself; jsdom has no ResizeObserver.
if (!('ResizeObserver' in globalThis)) {
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const h = vi.hoisted(() => {
  const state = {
    user: null as Record<string, unknown> | null,
    profile: { username: null as string | null },
    updateError: null as { code: string } | null,
  };
  const calls = {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    updateUser: vi.fn(async () => ({ error: null })),
    invoke: vi.fn(async () => ({ data: { success: true }, error: null })),
    signOut: vi.fn(async () => undefined),
  };
  const from = (table: string) => {
    if (table !== 'profiles') throw new Error(`unexpected table ${table}`);
    return {
      select: (cols: string) => {
        calls.select(cols);
        return { eq: () => ({ maybeSingle: async () => ({ data: { ...state.profile }, error: null }) }) };
      },
      update: (values: Record<string, unknown>) => {
        calls.update(values);
        return {
          eq: () => ({
            select: async () =>
              state.updateError ? { data: null, error: state.updateError } : { data: [{ id: 'p1' }], error: null },
          }),
        };
      },
      insert: async (values: Record<string, unknown>) => {
        calls.insert(values);
        return { error: null };
      },
    };
  };
  return { state, calls, from };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: h.state.user, loading: false, signOut: h.calls.signOut }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: h.from,
    auth: { updateUser: h.calls.updateUser, signOut: vi.fn() },
    functions: { invoke: h.calls.invoke },
  },
}));

import { AccountSetupProvider } from '@/contexts/AccountSetupContext';
import { AccountSetupGate } from '@/components/auth/AccountSetupGate';

function renderGate(path = '/foodie') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AccountSetupProvider>
        <AccountSetupGate>
          <p>The app</p>
        </AccountSetupGate>
      </AccountSetupProvider>
    </MemoryRouter>,
  );
}

const newGoogleUser = {
  id: 'g1',
  email: 'ada@gmail.com',
  app_metadata: { provider: 'google', providers: ['google'] },
  user_metadata: { full_name: 'Ada Lovelace' },
  identities: [{ provider: 'google' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  h.state.profile = { username: null };
  h.state.updateError = null;
});

describe('AccountSetupGate', () => {
  it('lets email accounts straight through without any extra request', () => {
    h.state.user = { id: 'e1', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {} };
    renderGate();
    expect(screen.getByText('The app')).toBeTruthy();
    expect(h.calls.select).not.toHaveBeenCalled();
  });

  it('lets a finished Apple/Google account through', async () => {
    h.state.user = { ...newGoogleUser, user_metadata: { terms_accepted_at: '2026-11-22T00:00:00Z' } };
    h.state.profile = { username: 'ada' };
    renderGate();
    expect(await screen.findByText('The app')).toBeTruthy();
  });

  it('holds a new Google account at setup, with suggestions filled in', async () => {
    h.state.user = newGoogleUser;
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Finish setting up your account' })).toBeTruthy();
    expect(screen.queryByText('The app')).toBeNull();
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('ada');
    expect((screen.getByLabelText(/Display name/) as HTMLInputElement).value).toBe('Ada Lovelace');
    expect(screen.getByText(/Signed in with Google as ada@gmail.com/)).toBeTruthy();
  });

  it('requires the Terms and a valid username before saving anything', async () => {
    h.state.user = newGoogleUser;
    renderGate();
    const user = userEvent.setup();
    const field = await screen.findByLabelText('Username');
    await user.clear(field);
    await user.type(field, 'ab');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText(/at least 3 characters/)).toBeTruthy();
    expect(screen.getByText(/Please agree to the Terms/)).toBeTruthy();
    expect(h.calls.update).not.toHaveBeenCalled();
    expect(h.calls.updateUser).not.toHaveBeenCalled();
  });

  it('saves the profile, then records acceptance of the current Terms', async () => {
    h.state.user = newGoogleUser;
    renderGate();
    const user = userEvent.setup();
    await screen.findByLabelText('Username');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(h.calls.updateUser).toHaveBeenCalled());
    expect(h.calls.update).toHaveBeenCalledWith({ username: 'ada', display_name: 'Ada Lovelace' });
    const arg = (h.calls.updateUser.mock.calls[0] as unknown[])[0] as { data: Record<string, string> };
    expect(arg.data.terms_version).toBe('2026-10-07');
    expect(Number.isNaN(Date.parse(arg.data.terms_accepted_at))).toBe(false);
  });

  it('says when a username is taken and records nothing else', async () => {
    h.state.user = newGoogleUser;
    h.state.updateError = { code: '23505' };
    renderGate();
    const user = userEvent.setup();
    await screen.findByLabelText('Username');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('This username is already taken')).toBeTruthy();
    expect(h.calls.updateUser).not.toHaveBeenCalled();
  });

  it('a returning, finished account goes straight in on launch (checked in the background)', () => {
    h.state.user = { ...newGoogleUser, user_metadata: { terms_accepted_at: '2026-11-22T00:00:00Z' } };
    h.state.profile = { username: 'ada' };
    localStorage.setItem('afiyeat-setup-done:g1', '1');
    renderGate();
    expect(screen.getByText('The app')).toBeTruthy();
    expect(h.calls.select).toHaveBeenCalled();
  });

  it('the device flag never skips the Terms', async () => {
    h.state.user = newGoogleUser;
    localStorage.setItem('afiyeat-setup-done:g1', '1');
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Finish setting up your account' })).toBeTruthy();
  });

  it('still opens the Terms and Privacy pages during setup', async () => {
    h.state.user = newGoogleUser;
    renderGate('/terms');
    expect(screen.getByText('The app')).toBeTruthy();
  });

  it('offers to remove a mistaken new Apple account and then signs out', async () => {
    h.state.user = {
      id: 'a1',
      email: 'x@privaterelay.appleid.com',
      app_metadata: { provider: 'apple', providers: ['apple'] },
      user_metadata: {},
      identities: [{ provider: 'apple' }],
    };
    renderGate();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Already have an Afiyeat account?' }));
    expect(screen.getByText(/Hide My Email does this/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove it and sign in another way' }));
    await waitFor(() => expect(h.calls.signOut).toHaveBeenCalled());
    expect(h.calls.invoke).toHaveBeenCalledWith('delete-account');
  });

  it('never offers removal once the account has a username', async () => {
    h.state.user = newGoogleUser;
    h.state.profile = { username: 'ada' };
    renderGate();
    await screen.findByRole('heading', { name: 'Finish setting up your account' });
    expect(screen.queryByRole('button', { name: 'Already have an Afiyeat account?' })).toBeNull();
  });
});
