import { useCallback, useEffect, useState } from 'react';
import { Check, Mail } from 'lucide-react';
import { toast } from 'sonner';
import type { UserIdentity } from '@supabase/supabase-js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { AppleLogo, GoogleLogo } from '@/components/auth/SocialSignInButtons';
import { friendlyAuthError, isCancellation } from '@/lib/socialAuth/callback';
import { PROVIDER_LABEL, type SocialProvider } from '@/lib/socialAuth/config';
import { useSocialProviders } from '@/lib/socialAuth/providers';
import { linkProvider } from '@/lib/socialAuth/socialAuth';

/**
 * Profile › Sign-in methods: which ways open this account, and a way to
 * connect Apple or Google to it. Connecting keeps the same account - its
 * id, lists, recipes, photos, followers and invites - and is how someone
 * whose Apple (Hide My Email) or Google address differs from their
 * Afiyeat email gets one account for both.
 *
 * Deliberately no "disconnect" here: removing a sign-in method can lock
 * someone out, and isn't needed for launch.
 */
export function SignInMethodsCard() {
  const { user } = useAuth();
  const offered = useSocialProviders();
  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  const [busy, setBusy] = useState<SocialProvider | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.auth.getUserIdentities();
    setIdentities(error ? [] : data?.identities ?? []);
  }, []);

  useEffect(() => {
    if (user) void load();
    // Re-read after a connection updates the user.
  }, [user, load]);

  if (!user) return null;

  const has = (provider: string) => identities?.some((identity) => identity.provider === provider) ?? false;
  // Shown so people can find the address Afiyeat has for them - for Apple
  // that may be a Hide My Email relay address (Apple HIG: let people view it).
  const emailFor = (provider: string) => {
    const email = identities?.find((identity) => identity.provider === provider)?.identity_data?.email;
    return typeof email === 'string' ? email : undefined;
  };
  const hasEmail = has('email') || (!!user.email && (user.app_metadata?.providers ?? []).includes('email'));
  const rows: SocialProvider[] = (['apple', 'google'] as SocialProvider[]).filter(
    (provider) => has(provider) || offered.includes(provider),
  );
  if (rows.length === 0 && identities !== null) return null;

  const connect = async (provider: SocialProvider) => {
    if (busy) return;
    setBusy(provider);
    try {
      await linkProvider(provider);
      await load();
      toast.success(`${PROVIDER_LABEL[provider]} is now connected to your account`);
    } catch (error) {
      if (!isCancellation(error)) toast.error(friendlyAuthError(error, provider));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Sign-in methods</CardTitle>
        <CardDescription>Ways to open this same account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {identities === null ? (
          <div className="flex justify-center py-2">
            <Spinner className="h-5 w-5" label="Loading sign-in methods" />
          </div>
        ) : (
          <>
            {hasEmail && (
              <MethodRow icon={<Mail className="h-[18px] w-[18px] text-muted-foreground" />} name="Email" detail={user.email ?? undefined}>
                <ConnectedMark />
              </MethodRow>
            )}
            {rows.map((provider) => (
              <MethodRow
                key={provider}
                icon={provider === 'apple' ? <AppleLogo className="h-[18px] w-[18px]" /> : <GoogleLogo className="h-[18px] w-[18px]" />}
                name={PROVIDER_LABEL[provider]}
                detail={has(provider) ? emailFor(provider) : undefined}
              >
                {has(provider) ? (
                  <ConnectedMark />
                ) : (
                  <button
                    type="button"
                    className="active-press inline-flex h-9 min-w-[5.5rem] items-center justify-center rounded-md border px-3 text-sm font-medium disabled:opacity-60"
                    onClick={() => void connect(provider)}
                    disabled={busy !== null}
                    aria-label={`Connect ${PROVIDER_LABEL[provider]}`}
                  >
                    {busy === provider ? <Spinner className="h-4 w-4" label="Connecting" /> : 'Connect'}
                  </button>
                )}
              </MethodRow>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MethodRow({ icon, name, detail, children }: { icon: React.ReactNode; name: string; detail?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 min-h-11">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-tight">{name}</p>
        {detail && <p className="text-sm text-muted-foreground truncate">{detail}</p>}
      </div>
      {children}
    </div>
  );
}

function ConnectedMark() {
  return (
    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
      <Check className="h-4 w-4" aria-hidden="true" /> Connected
    </span>
  );
}
