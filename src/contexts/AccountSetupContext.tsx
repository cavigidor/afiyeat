import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { createdWithSocialProvider, isMissingBackend, setupNeeds, type SetupNeeds, type SetupRecord } from '@/lib/accountSetup';

// Whether the signed-in account still has to finish setup (see
// lib/accountSetup.ts). Only accounts created by Apple or Google are ever
// checked; for everyone else this is 'complete' straight away, with no
// extra request. Anything that writes to the account or registers the
// device (push token, timezone, invite claim) waits for 'complete'.

export type AccountSetupStatus = 'signed-out' | 'checking' | 'needed' | 'complete' | 'unavailable' | 'error';

interface AccountSetupValue {
  status: AccountSetupStatus;
  needs: SetupNeeds | null;
  /** The username already saved, if any (prefills the form). */
  savedUsername: string | null;
  /** Re-reads the account, e.g. after saving or a failed check. */
  refresh: () => void;
}

const AccountSetupContext = createContext<AccountSetupValue | undefined>(undefined);

// terms_acceptances isn't in the generated types until the backend
// proposal is applied and Lovable regenerates them.
const db = supabase as unknown as SupabaseClient;

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

type Loaded = { userId: string; record: SetupRecord } | { userId: string; unavailable: true };

export function AccountSetupProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);

  const userId = user?.id ?? null;
  const checks = !!user && createdWithSocialProvider(user);

  useEffect(() => {
    setFailed(false);
    if (!userId || !checks) {
      setLoaded(null);
      return;
    }
    let active = true;
    void (async () => {
      const [profile, terms] = await Promise.all([
        supabase.from('profiles').select('username').eq('user_id', userId).maybeSingle(),
        db.from('terms_acceptances').select('id').eq('user_id', userId).limit(1),
      ]);
      if (!active) return;
      if (isMissingBackend(terms.error)) {
        setLoaded({ userId, unavailable: true });
        return;
      }
      if (profile.error || terms.error) {
        setFailed(true);
        return;
      }
      setLoaded({
        userId,
        record: { username: profile.data?.username ?? null, acceptedTerms: (terms.data ?? []).length > 0 },
      });
    })();
    return () => {
      active = false;
    };
  }, [userId, checks, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const value = useMemo<AccountSetupValue>(() => {
    const none = { needs: null, savedUsername: null, refresh };
    if (loading) return { status: 'checking', ...none };
    if (!user) return { status: 'signed-out', ...none };
    if (!checks) return { status: 'complete', ...none };
    const known = loaded && loaded.userId === user.id ? loaded : null;
    if (!known) {
      // Not checked yet this launch: trust a finished setup seen before on
      // this device (the background check still corrects it).
      if (readDone(user.id)) return { status: 'complete', ...none };
      if (failed) return { status: 'error', ...none };
      return { status: 'checking', ...none };
    }
    if ('unavailable' in known) return { status: 'unavailable', ...none };
    const needs = setupNeeds(user, known.record);
    return { status: needs ? 'needed' : 'complete', needs, savedUsername: known.record.username, refresh };
  }, [loading, user, checks, failed, loaded, refresh]);

  useEffect(() => {
    if (!user || !checks || !loaded || loaded.userId !== user.id || 'unavailable' in loaded) return;
    writeDone(user.id, value.status === 'complete');
  }, [user, checks, loaded, value.status]);

  return <AccountSetupContext.Provider value={value}>{children}</AccountSetupContext.Provider>;
}

export function useAccountSetup(): AccountSetupValue {
  const value = useContext(AccountSetupContext);
  if (!value) throw new Error('useAccountSetup must be used within an AccountSetupProvider');
  return value;
}
