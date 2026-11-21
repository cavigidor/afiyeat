import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, ChefHat, ShieldCheck, X } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Seo } from '@/components/Seo';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { clearReturnTo, peekReturnTo, setReturnTo } from '@/lib/passport';

/**
 * /oauth/consent - where Supabase Auth sends someone connecting an outside
 * app (ChatGPT) to their Afiyeat account. Supabase's OAuth 2.1 server adds
 * `authorization_id`; this page signs them in if needed, shows who is
 * asking and what it will be able to do, and records their decision.
 * Approving lets the app save and read recipes in this account through the
 * afiyeat-mcp edge function (see docs/CHATGPT_INTEGRATION.md).
 *
 * Supabase must be configured with this path as the OAuth server's
 * authorization path for the redirect to arrive here.
 */

type Details = {
  clientName: string;
  clientHost: string | null;
  email: string;
};

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; details: Details }
  | { kind: 'deciding'; details: Details; approving: boolean }
  | { kind: 'error'; message: string };

function hostOf(uri: string | null | undefined): string | null {
  if (!uri) return null;
  try {
    return new URL(uri).host;
  } catch {
    return null;
  }
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get('authorization_id') ?? '';
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const here = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;

  // Not signed in: sign in first, then come back here.
  useEffect(() => {
    if (authLoading || !authorizationId || user) return;
    setReturnTo(here);
    navigate('/auth');
  }, [authLoading, authorizationId, user, here, navigate]);

  useEffect(() => {
    if (!authorizationId) {
      setState({ kind: 'error', message: 'This link is missing its authorization code. Start the connection again from the other app.' });
      return;
    }
    if (authLoading || !user) return;
    // We made it back from sign-in; the stored return path has done its job.
    if (peekReturnTo()?.startsWith('/oauth/consent')) clearReturnTo();

    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (cancelled) return;
      if (error || !data) {
        setState({
          kind: 'error',
          message: 'This connection request has expired or is no longer valid. Start again from the other app.',
        });
        return;
      }
      // Already approved earlier: Supabase hands back where to continue.
      if (data.redirect_url && !data.authorization_id) {
        window.location.assign(data.redirect_url);
        return;
      }
      setState({
        kind: 'ready',
        details: {
          clientName: data.client?.name?.trim() || 'An app',
          clientHost: hostOf(data.client?.uri),
          email: data.user?.email ?? user.email ?? '',
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [authorizationId, authLoading, user]);

  const decide = async (approve: boolean) => {
    if (state.kind !== 'ready') return;
    setState({ kind: 'deciding', details: state.details, approving: approve });
    const { data, error } = approve
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (error || !data?.redirect_url) {
      setState({ kind: 'error', message: "Couldn't record your choice. Start the connection again from the other app." });
      return;
    }
    window.location.assign(data.redirect_url);
  };

  const switchAccount = async () => {
    setReturnTo(here);
    await signOut();
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-background">
      <Seo title="Connect an app | Afiyeat" description="Allow an app to access your Afiyeat recipes." path="/oauth/consent" />
      <Navbar />
      <main className="container py-8 sm:py-12 px-4 sm:px-6 max-w-lg">
        {state.kind === 'loading' && (
          <div className="flex justify-center py-16">
            <Spinner className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {state.kind === 'error' && (
          <Card>
            <CardContent className="p-6 space-y-4">
              <h1 className="text-xl font-bold">Can't connect</h1>
              <p className="text-muted-foreground">{state.message}</p>
              <Button variant="outline" onClick={() => navigate('/foodie')}>
                Go to Afiyeat
              </Button>
            </CardContent>
          </Card>
        )}

        {(state.kind === 'ready' || state.kind === 'deciding') && (
          <Card>
            <CardContent className="p-6 space-y-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-primary">
                  <ShieldCheck className="h-5 w-5" />
                  <span className="text-sm font-medium">Connection request</span>
                </div>
                <h1 className="text-xl sm:text-2xl font-bold">
                  Allow {state.details.clientName} to access your Afiyeat recipes?
                </h1>
                {state.details.clientHost && (
                  <p className="text-sm text-muted-foreground">From {state.details.clientHost}</p>
                )}
              </div>

              <div className="space-y-3 text-sm">
                <p className="font-medium">Through Afiyeat's connector it can:</p>
                <ul className="space-y-2">
                  <li className="flex gap-2">
                    <ChefHat className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                    <span>Save recipes you ask it to save. They're saved as private.</span>
                  </li>
                  <li className="flex gap-2">
                    <Check className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                    <span>Find, read and update your recipes.</span>
                  </li>
                  <li className="flex gap-2 text-muted-foreground">
                    <X className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>It can't make recipes public or delete them. Only you can, in Afiyeat.</span>
                  </li>
                </ul>
                <p className="text-muted-foreground">
                  Only allow this if you just started connecting {state.details.clientName} yourself.
                </p>
              </div>

              <p className="text-sm text-muted-foreground">
                Signed in as <span className="font-medium text-foreground">{state.details.email}</span>.{' '}
                <button
                  type="button"
                  className="text-primary hover:underline disabled:opacity-50"
                  onClick={() => void switchAccount()}
                  disabled={state.kind === 'deciding'}
                >
                  Not you?
                </button>
              </p>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => void decide(false)}
                  disabled={state.kind === 'deciding'}
                >
                  {state.kind === 'deciding' && !state.approving && <Spinner className="h-4 w-4 mr-2 animate-spin" />}
                  Deny
                </Button>
                <Button className="flex-1" onClick={() => void decide(true)} disabled={state.kind === 'deciding'}>
                  {state.kind === 'deciding' && state.approving && <Spinner className="h-4 w-4 mr-2 animate-spin" />}
                  Allow
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                You can disconnect at any time from the app's connector settings.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
