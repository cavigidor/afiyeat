import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { createdWithSocialProvider, setupNeeds, type SetupNeeds } from '@/lib/accountSetup';

// Whether the signed-in account still has to finish setup (see
// lib/accountSetup.ts). Only accounts created by Apple or Google are ever
// checked; for everyone else this is 'complete' straight away, with no
// extra request.

export type AccountSetupStatus = 'signed-out' | 'checking' | 'needed' | 'complete' | 'error';

interface AccountSetupValue {
  status: AccountSetupStatus;
  needs: SetupNeeds | null;
  /** The username already saved, if any (prefills the form). */
  savedUsername: string | null;
  /** Re-reads the profile, e.g. after saving or a failed check. */
  refresh: () => void;
}

const AccountSetupContext = createContext<AccountSetupValue | undefined>(undefined);

// Remembers, per account on this device, that setup was already finished,
// so a returning Apple/Google user goes straight into the app on launch
// while the check runs in the background (instead of a spinner each time).
const DONE_KEY = (userId: string) => `afiyeat-setup-done:${userId}`;

function readDone(userId: string): boolean {
  try {
    return localStorage.getItem(DONE_KEY(userId)) === '1';
  } catch {
    return false;
  }
}

function writeDone(userId: string, done: boolean): void {
  try {
    if (done) localStorage.setItem(DONE_KEY(userId), '1');
    else localStorage.removeItem(DONE_KEY(userId));
  } catch {
    /* not worth failing over */
  }
}

export function AccountSetupProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [profile, setProfile] = useState<{ userId: string; username: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);

  const userId = user?.id ?? null;
  const checks = !!user && createdWithSocialProvider(user);

  useEffect(() => {
    setFailed(false);
    if (!userId || !checks) {
      setProfile(null);
      return;
    }
    let active = true;
    void (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('username')
        .eq('user_id', userId)
        .maybeSingle();
      if (!active) return;
      if (error) {
        setFailed(true);
        return;
      }
      setProfile({ userId, username: data?.username ?? null });
    })();
    return () => {
      active = false;
    };
  }, [userId, checks, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const value = useMemo<AccountSetupValue>(() => {
    if (loading) return { status: 'checking', needs: null, savedUsername: null, refresh };
    if (!user) return { status: 'signed-out', needs: null, savedUsername: null, refresh };
    if (!checks) return { status: 'complete', needs: null, savedUsername: null, refresh };
    const known = profile && profile.userId === user.id ? profile : null;
    if (!known) {
      // Not checked yet this launch: trust a finished setup seen before on
      // this device (the background check still corrects it).
      if (readDone(user.id) && !setupNeeds(user, { username: 'saved' })) {
        return { status: 'complete', needs: null, savedUsername: null, refresh };
      }
      if (failed) return { status: 'error', needs: null, savedUsername: null, refresh };
      return { status: 'checking', needs: null, savedUsername: null, refresh };
    }
    const needs = setupNeeds(user, known);
    return { status: needs ? 'needed' : 'complete', needs, savedUsername: known.username, refresh };
  }, [loading, user, checks, failed, profile, refresh]);

  useEffect(() => {
    if (!user || !checks || !profile || profile.userId !== user.id) return;
    writeDone(user.id, value.status === 'complete');
  }, [user, checks, profile, value.status]);

  return <AccountSetupContext.Provider value={value}>{children}</AccountSetupContext.Provider>;
}

export function useAccountSetup(): AccountSetupValue {
  const value = useContext(AccountSetupContext);
  if (!value) throw new Error('useAccountSetup must be used within an AccountSetupProvider');
  return value;
}
