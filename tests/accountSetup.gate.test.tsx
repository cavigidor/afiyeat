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
    accepted: false,
    termsError: null as { code: string; message: string } | null,
    rpcError: null as { code?: string; message: string } | null,
    deletion: { status: 'deleted' } as Record<string, unknown>,
  };
  const calls = {
    profileSelect: vi.fn(),
    termsSelect: vi.fn(),
    profileUpdate: vi.fn(),
    rpc: vi.fn(),
    updateUser: vi.fn(),
    invoke: vi.fn(),
    signOut: vi.fn(async () => undefined),
    deleteMyAccount: vi.fn(),
  };
  const from = (table: string) => {
    if (table === 'profiles') {
      return {
        select: (cols: string) => {
          calls.profileSelect(cols);
          return { eq: () => ({ maybeSingle: async () => ({ data: { ...state.profile }, error: null }) }) };
        },
        update: (v: unknown) => { calls.profileUpdate(v); return { eq: () => ({ select: async () => ({ data: [], error: null }) }) }; },
      };
    }
    if (table === 'terms_acceptances') {
      return {
        select: () => {
          calls.termsSelect();
          return { eq: () => ({ limit: async () => (state.termsError ? { data: null, error: state.termsError } : { data: state.accepted ? [{ id: 't' }] : [], error: null }) }) };
        },
      };
    }
    throw new Error(`unexpected table ${table}`);
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
    rpc: async (name: string, args: unknown) => { h.calls.rpc(name, args); return { data: null, error: h.state.rpcError }; },
    auth: { updateUser: h.calls.updateUser, signOut: vi.fn() },
    functions: { invoke: h.calls.invoke },
  },
}));
vi.mock('@/lib/accountDeletion', () => ({
  deleteMyAccount: async (args: unknown) => { h.calls.deleteMyAccount(args); return h.state.deletion; },
}));

import { toast } from 'sonner';
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
const newAppleUser = {
  id: 'a1',
  email: 'x@privaterelay.appleid.com',
  app_metadata: { provider: 'apple', providers: ['apple'] },
  user_metadata: {},
  identities: [{ provider: 'apple' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  h.state.profile = { username: null };
  h.state.accepted = false;
  h.state.termsError = null;
  h.state.rpcError = null;
  h.state.deletion = { status: 'deleted' };
});

describe('AccountSetupGate', () => {
  it('lets email accounts straight through without any extra request', () => {
    h.state.user = { id: 'e1', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {} };
    renderGate();
    expect(screen.getByText('The app')).toBeTruthy();
    expect(h.calls.profileSelect).not.toHaveBeenCalled();
    expect(h.calls.termsSelect).not.toHaveBeenCalled();
  });

  it('lets a finished Apple/Google account through only with a server-recorded acceptance', async () => {
    h.state.user = newGoogleUser;
    h.state.profile = { username: 'ada' };
    h.state.accepted = true;
    renderGate();
    expect(await screen.findByText('The app')).toBeTruthy();
  });

  it('a username plus acceptance claimed only in user_metadata is not enough', async () => {
    h.state.user = { ...newGoogleUser, user_metadata: { terms_accepted_at: '2026-11-22T00:00:00Z' } };
    h.state.profile = { username: 'ada' };
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Finish setting up your account' })).toBeTruthy();
  });

  it('holds a new Google account at setup, with suggestions filled in', async () => {
    h.state.user = newGoogleUser;
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Finish setting up your account' })).toBeTruthy();
    expect(screen.queryByText('The app')).toBeNull();
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('ada');
    expect((screen.getByLabelText(/Display name/) as HTMLInputElement).value).toBe('Ada Lovelace');
  });

  it("prefills Apple's one-time name from this device", async () => {
    h.state.user = newAppleUser;
    sessionStorage.setItem('afiyeat-apple-name:a1', 'Grace Hopper');
    renderGate();
    expect(((await screen.findByLabelText(/Display name/)) as HTMLInputElement).value).toBe('Grace Hopper');
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
    expect(h.calls.rpc).not.toHaveBeenCalled();
  });

  it('saves through one server call that records the current Terms and Privacy versions', async () => {
    h.state.user = newAppleUser;
    sessionStorage.setItem('afiyeat-apple-name:a1', 'Grace Hopper');
    renderGate();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Username'), 'grace');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(h.calls.rpc).toHaveBeenCalled());
    expect(h.calls.rpc).toHaveBeenCalledWith('complete_account_setup', {
      p_username: 'grace', p_display_name: 'Grace Hopper', p_terms_version: '2026-10-07', p_privacy_version: '2026-10-07',
    });
    // No direct profile write and nothing in the account's own metadata.
    expect(h.calls.profileUpdate).not.toHaveBeenCalled();
    expect(h.calls.updateUser).not.toHaveBeenCalled();
    await waitFor(() => expect(sessionStorage.getItem('afiyeat-apple-name:a1')).toBeNull());
  });

  it('says when a username is taken', async () => {
    h.state.user = newGoogleUser;
    h.state.rpcError = { code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_key"' };
    renderGate();
    const user = userEvent.setup();
    await screen.findByLabelText('Username');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('This username is already taken')).toBeTruthy();
  });

  it('shows "not ready" (and offers only sign-out) when the backend pieces are missing', async () => {
    h.state.user = newGoogleUser;
    h.state.termsError = { code: 'PGRST205', message: "Could not find the table 'public.terms_acceptances' in the schema cache" };
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Almost ready' })).toBeTruthy();
    expect(screen.queryByLabelText('Username')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    expect(h.calls.signOut).toHaveBeenCalled();
  });

  it('still opens the Terms and Privacy pages during setup', async () => {
    h.state.user = newGoogleUser;
    renderGate('/terms');
    expect(screen.getByText('The app')).toBeTruthy();
  });

  it('a returning, finished account goes straight in on launch (checked in the background)', () => {
    h.state.user = newGoogleUser;
    h.state.profile = { username: 'ada' };
    h.state.accepted = true;
    localStorage.setItem('afiyeat-setup-done:g1', '1');
    renderGate();
    expect(screen.getByText('The app')).toBeTruthy();
    expect(h.calls.termsSelect).toHaveBeenCalled();
  });

  it('the device flag is corrected by the server check', async () => {
    h.state.user = newGoogleUser;
    localStorage.setItem('afiyeat-setup-done:g1', '1');
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Finish setting up your account' })).toBeTruthy();
    expect(localStorage.getItem('afiyeat-setup-done:g1')).toBeNull();
  });

  it('removing a mistaken new account goes through the server-checked discard, then signs out', async () => {
    h.state.user = newAppleUser;
    renderGate();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Already have an Afiyeat account?' }));
    expect(screen.getByText(/Hide My Email does this/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove it and sign in another way' }));
    await waitFor(() => expect(h.calls.signOut).toHaveBeenCalled());
    expect(h.calls.deleteMyAccount).toHaveBeenCalledWith({ mode: 'discard_new_account', continueWithoutApple: false });
    expect(h.calls.invoke).not.toHaveBeenCalled();
  });

  it('if the server refuses (the account has activity) nothing is removed and the person stays signed in', async () => {
    h.state.user = newGoogleUser;
    h.state.deletion = { status: 'not_discardable' };
    renderGate();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Already have an Afiyeat account?' }));
    await user.click(screen.getByRole('button', { name: 'Remove it and sign in another way' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/already has activity/), expect.anything()));
    expect(h.calls.signOut).not.toHaveBeenCalled();
  });

  it('if Apple could not be disconnected, offers to try again or delete anyway', async () => {
    h.state.user = newAppleUser;
    h.state.deletion = { status: 'apple_problem', reason: 'cancelled' };
    renderGate();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Already have an Afiyeat account?' }));
    await user.click(screen.getByRole('button', { name: 'Remove it and sign in another way' }));
    expect(await screen.findByRole('heading', { name: 'Disconnect Sign in with Apple' })).toBeTruthy();
    h.state.deletion = { status: 'deleted', appleRevocation: 'skipped' };
    await user.click(screen.getByRole('button', { name: 'Delete anyway' }));
    await waitFor(() => expect(h.calls.signOut).toHaveBeenCalled());
    expect(h.calls.deleteMyAccount).toHaveBeenLastCalledWith({ mode: 'discard_new_account', continueWithoutApple: true });
  });

  it('never offers removal once the account has a username', async () => {
    h.state.user = newGoogleUser;
    h.state.profile = { username: 'ada' };
    renderGate();
    await screen.findByRole('heading', { name: 'Finish setting up your account' });
    expect(screen.queryByRole('button', { name: 'Already have an Afiyeat account?' })).toBeNull();
  });
});
