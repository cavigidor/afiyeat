import { useState } from 'react';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { friendlyAuthError, isCancellation } from '@/lib/socialAuth/callback';
import { providerButtonLabel, type SocialProvider } from '@/lib/socialAuth/config';

export function AppleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z" />
    </svg>
  );
}

export function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

interface SocialButtonProps {
  provider: SocialProvider;
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}

/**
 * One provider button, drawn to each provider's own rules: Apple's is
 * black with the Apple logo (Human Interface Guidelines), Google's is
 * white with the four-colour "G" and a grey outline (Google Identity
 * branding guidelines). Both are full width and 44pt tall, the iOS
 * minimum touch target.
 */
export function SocialButton({ provider, label, busy, disabled, onClick }: SocialButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy}
      className={cn(
        'active-press relative flex h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-[15px] font-medium',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        provider === 'apple'
          ? 'bg-black text-white'
          : 'border border-[#747775] bg-white text-[#1F1F1F]',
      )}
    >
      {busy ? (
        <Spinner className="h-4 w-4" label={`Signing in with ${provider === 'apple' ? 'Apple' : 'Google'}`} />
      ) : provider === 'apple' ? (
        <AppleLogo className="h-[18px] w-[18px] -mt-0.5" />
      ) : (
        <GoogleLogo className="h-[18px] w-[18px]" />
      )}
      <span>{label}</span>
    </button>
  );
}

interface SocialSignInButtonsProps {
  mode: 'signin' | 'signup';
  providers: SocialProvider[];
  /** Runs the sign-in; resolves when signed in, rejects on cancel or error. */
  onSignIn: (provider: SocialProvider) => Promise<void>;
  /** The email form is busy: keep these disabled too. */
  disabled?: boolean;
}

export function SocialSignInButtons({ mode, providers, onSignIn, disabled = false }: SocialSignInButtonsProps) {
  const [busy, setBusy] = useState<SocialProvider | null>(null);

  if (providers.length === 0) return null;

  const run = async (provider: SocialProvider) => {
    if (busy) return;
    setBusy(provider);
    try {
      await onSignIn(provider);
    } catch (error) {
      if (!isCancellation(error)) toast.error(friendlyAuthError(error, provider));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {providers.map((provider) => (
        <SocialButton
          key={provider}
          provider={provider}
          label={providerButtonLabel(provider, mode)}
          busy={busy === provider}
          disabled={disabled || busy !== null}
          onClick={() => void run(provider)}
        />
      ))}
      {mode === 'signup' && (
        <p className="text-xs text-muted-foreground text-center leading-snug">
          New to Afiyeat? You'll choose a username and agree to the Terms and Privacy Policy next.
        </p>
      )}
      <div className="relative py-1" role="separator" aria-label="or use email">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">or use email</span>
        </div>
      </div>
    </div>
  );
}
