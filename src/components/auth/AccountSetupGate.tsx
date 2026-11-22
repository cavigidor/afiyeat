import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Spinner } from '@/components/ui/spinner';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useAuth } from '@/contexts/AuthContext';
import { useAccountSetup } from '@/contexts/AccountSetupContext';
import { supabase } from '@/integrations/supabase/client';
import { blockedByContentFilter } from '@/lib/contentFilter';
import {
  canDiscardNewAccount,
  isMissingBackend,
  suggestDisplayName,
  suggestUsername,
  validateUsername,
} from '@/lib/accountSetup';
import { PRIVACY_VERSION, PROVIDER_LABEL, TERMS_VERSION } from '@/lib/socialAuth/config';
import { forgetAppleName, readAppleName } from '@/lib/socialAuth/socialAuth';
import { useAccountDeletion } from '@/components/auth/useAccountDeletion';
import logo from '@/assets/logo.png';

// complete_account_setup() isn't in the generated types until the backend
// proposal is applied and Lovable regenerates them.
const db = supabase as unknown as SupabaseClient;

// Screens a new Apple/Google account can still open before finishing
// setup: the documents it's asked to accept, help, and the sign-in
// callback itself.
const OPEN_DURING_SETUP = ['/terms', '/privacy', '/support', '/auth/callback'];

/**
 * Holds a brand-new Apple or Google account at a short setup screen until
 * it has a username and has accepted the Terms and Privacy Policy, exactly
 * like the email sign-up form requires. Everyone else passes straight
 * through - existing and email accounts are never checked.
 */
export function AccountSetupGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { status } = useAccountSetup();
  const location = useLocation();

  // Signed out, still starting up, or nothing to do: unchanged app.
  if (!user || status === 'signed-out' || status === 'complete') return <>{children}</>;
  if (OPEN_DURING_SETUP.includes(location.pathname)) return <>{children}</>;

  if (status === 'checking') {
    // Only reached for Apple/Google accounts (and the instant before auth
    // resolves at launch, when the splash screen is still up).
    return (
      <main className="min-h-screen flex items-center justify-center bg-background" aria-busy="true">
        <Spinner className="h-6 w-6" label="Loading your account" />
      </main>
    );
  }
  return <AccountSetupScreen />;
}

function AccountSetupScreen() {
  const { user, signOut } = useAuth();
  const { status, needs, savedUsername, refresh } = useAccountSetup();
  const navigate = useNavigate();

  const [username, setUsername] = useState(() => savedUsername ?? suggestUsername(user));
  const [displayName, setDisplayName] = useState(() => suggestDisplayName(user, user ? readAppleName(user.id) : ''));
  const [accepted, setAccepted] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  // "Already have an Afiyeat account?": the server removes the new account
  // only if it's brand new and untouched (delete-account discard_new_account),
  // and disconnects Sign in with Apple first for Apple accounts.
  const discardFlow = useAccountDeletion(async () => {
    setDiscardOpen(false);
    await signOut().catch(() => supabase.auth.signOut({ scope: 'local' }));
    toast.success(
      `Done. Sign in to your existing account with email, then connect ${providerName} in Profile › Sign-in methods.`,
      { duration: 8000 },
    );
    navigate('/auth', { replace: true });
  });
  const discarding = discardFlow.busy;

  const provider = user?.app_metadata?.provider === 'apple' ? 'apple' : 'google';
  const providerName = PROVIDER_LABEL[provider];
  const canDiscard = canDiscardNewAccount(user, needs);

  if (status === 'unavailable') {
    return (
      <SetupShell
        title="Almost ready"
        description={`Signing up with ${providerName} isn't switched on yet. Please sign out and use email for now.`}
      >
        <Button className="w-full" onClick={() => void signOut()}>Sign out</Button>
      </SetupShell>
    );
  }

  if (status === 'error') {
    return (
      <SetupShell title="Couldn't load your account" description="Check your connection and try again.">
        <div className="space-y-3">
          <Button className="w-full" onClick={refresh}>Try again</Button>
          <Button variant="ghost" className="w-full" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </SetupShell>
    );
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || saving) return;
    const name = username.trim();
    const shownName = displayName.trim();
    const invalid = validateUsername(name);
    setUsernameError(invalid);
    setTermsError(accepted ? null : 'Please agree to the Terms and Privacy Policy to continue');
    if (invalid || !accepted) return;
    // Name and username are shown to everyone who finds the profile.
    if (blockedByContentFilter(name, shownName)) return;

    setSaving(true);
    try {
      // One server call saves the username/display name AND records that
      // the current Terms and Privacy Policy were accepted, with the
      // server's clock. A taken username saves nothing at all.
      const { error } = await db.rpc('complete_account_setup', {
        p_username: name,
        p_display_name: shownName,
        p_terms_version: TERMS_VERSION,
        p_privacy_version: PRIVACY_VERSION,
      });
      if (error) {
        if (error.code === '23505') setUsernameError('This username is already taken');
        else if (/invalid_username/.test(error.message)) setUsernameError('Username must be 3-20 characters');
        else if (/terms_version_mismatch/.test(error.message)) toast.error('The Terms were just updated. Please close and reopen Afiyeat, then try again.');
        else if (isMissingBackend(error)) toast.error("Signing up this way isn't switched on yet. Please sign out and use email.");
        else toast.error("Couldn't save your profile. Please try again.");
        return;
      }
      forgetAppleName(user.id);
      refresh();
      toast.success('Welcome to Afiyeat!');
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    // Close this dialog first: Apple's sheet, or the "Disconnect Sign in
    // with Apple" choice, may need the screen next.
    setDiscardOpen(false);
    await discardFlow.run('discard_new_account');
  };

  return (
    <SetupShell
      title="Finish setting up your account"
      description={
        user?.email
          ? `Signed in with ${providerName} as ${user.email}`
          : `Signed in with ${providerName}`
      }
    >
      <form onSubmit={save} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="setup-username">Username</Label>
          <Input
            id="setup-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="foodlover123"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            maxLength={20}
            aria-invalid={!!usernameError}
            aria-describedby={usernameError ? 'setup-username-error' : undefined}
          />
          {usernameError && (
            <p id="setup-username-error" className="text-sm font-medium text-destructive">{usernameError}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="setup-display-name">Display name <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Input
            id="setup-display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="How your name appears to friends"
            maxLength={50}
            autoComplete="name"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-start gap-2.5">
            <Checkbox
              id="setup-terms"
              checked={accepted}
              onCheckedChange={(checked) => setAccepted(checked === true)}
              className="mt-0.5"
              aria-invalid={!!termsError}
            />
            <label htmlFor="setup-terms" className="text-sm text-muted-foreground leading-snug">
              I agree to the{' '}
              <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link>{' '}
              and{' '}
              <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>,
              including that there's no tolerance for objectionable content or abusive behaviour.
            </label>
          </div>
          {termsError && <p className="text-sm font-medium text-destructive">{termsError}</p>}
        </div>
        <Button type="submit" className="w-full" disabled={saving}>
          {saving && <Spinner className="mr-2 h-4 w-4" />}
          Continue
        </Button>
      </form>

      <div className="mt-6 space-y-2 text-center">
        {canDiscard && (
          <Button variant="link" className="text-sm h-auto py-1" onClick={() => setDiscardOpen(true)} disabled={discarding}>
            {discarding && <Spinner className="mr-2 h-4 w-4" label="Removing the new sign-in" />}
            Already have an Afiyeat account?
          </Button>
        )}
        <div>
          <Button variant="ghost" className="w-full" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </div>

      {discardFlow.dialog}
      <AlertDialog open={discardOpen} onOpenChange={(open) => !discarding && setDiscardOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Use your existing account?</AlertDialogTitle>
            <AlertDialogDescription>
              Signing in with {providerName} made a new, empty Afiyeat account, because it didn't match the
              email on your existing one ({providerName === 'Apple' ? 'Hide My Email does this' : 'a different email address does this'}).
              We'll remove this new empty account. Then sign in with your email and connect {providerName} in
              Profile › Sign-in methods, so both open the same account with all your lists and photos.
              {provider === 'apple' && ' You may be asked to confirm with Apple, so Apple disconnects Afiyeat from this sign-in too.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={discarding}>Keep this new account</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void discard();
              }}
              disabled={discarding}
            >
              {discarding && <Spinner className="mr-2 h-4 w-4" />}
              Remove it and sign in another way
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SetupShell>
  );
}

function SetupShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-accent/20 to-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <img src={logo} alt="Afiyeat" className="h-20 w-20 object-contain" />
          </div>
          <h1 className="text-xl font-semibold leading-none tracking-tight">{title}</h1>
          <CardDescription className="break-words">{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  );
}
