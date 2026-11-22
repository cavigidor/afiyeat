import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { SocialSignInButtons } from '@/components/auth/SocialSignInButtons';
import { SocialAuthCancelled } from '@/lib/socialAuth/callback';

beforeEach(() => vi.clearAllMocks());

describe('SocialSignInButtons', () => {
  it('shows nothing until a provider is switched on', () => {
    const { container } = render(<SocialSignInButtons mode="signin" providers={[]} onSignIn={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows Apple first, with the right wording on each tab', () => {
    const { unmount } = render(<SocialSignInButtons mode="signin" providers={['apple', 'google']} onSignIn={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Sign in with Apple', 'Continue with Google']);
    unmount();
    render(<SocialSignInButtons mode="signup" providers={['apple', 'google']} onSignIn={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Sign up with Apple' })).toBeTruthy();
    expect(screen.getByText(/choose a username and agree to the Terms/)).toBeTruthy();
  });

  it('disables both buttons while one is running, and is silent on cancel', async () => {
    let finish: (v?: unknown) => void = () => undefined;
    const onSignIn = vi.fn(() => new Promise((_, reject) => { finish = () => reject(new SocialAuthCancelled()); }));
    render(<SocialSignInButtons mode="signin" providers={['apple', 'google']} onSignIn={onSignIn as never} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign in with Apple' }));
    expect(onSignIn).toHaveBeenCalledWith('apple');
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
    finish();
    await waitFor(() => expect((screen.getAllByRole('button')[1] as HTMLButtonElement).disabled).toBe(false));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('explains a failure in plain words', async () => {
    const onSignIn = vi.fn(async () => { throw new Error('Unsupported provider: provider is not enabled'); });
    render(<SocialSignInButtons mode="signin" providers={['google']} onSignIn={onSignIn} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Google sign-in isn't switched on yet. Please use email for now."));
  });

  it('stays disabled while the email form is busy', () => {
    render(<SocialSignInButtons mode="signin" providers={['google']} onSignIn={vi.fn()} disabled />);
    expect((screen.getByRole('button', { name: 'Continue with Google' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
