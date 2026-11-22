import { useEffect, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { isNative } from '@/lib/native';
import { AfiyeatAuth, appleUserIdOf } from '@/lib/socialAuth/nativeAuth';

/**
 * iPhone only. Apple TN3194: when someone stops using Sign in with Apple
 * for Afiyeat (Settings › their name › Sign in with Apple), the app should
 * return to a signed-out state. Checks on launch and whenever the app
 * comes back to the foreground; only a definite "revoked" signs out
 * ("not found" just means this iPhone's Apple Account isn't the one
 * connected, e.g. it was connected on the website with another Apple ID).
 */
export function AppleCredentialWatcher() {
  const { user, signOut } = useAuth();
  const appleUser = appleUserIdOf(user);
  // signOut is a new function on every auth change; keep the effect keyed
  // on the Apple user id only.
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;

  useEffect(() => {
    if (!appleUser || !isNative()) return;
    let active = true;
    const check = async () => {
      try {
        const { state } = await AfiyeatAuth.getAppleCredentialState({ user: appleUser });
        if (active && state === 'revoked') {
          active = false;
          await signOutRef.current();
          toast('Sign in with Apple was turned off for Afiyeat, so you have been signed out.', { duration: 8000 });
        }
      } catch {
        /* older build without the check, or Apple unavailable: do nothing */
      }
    };
    void check();
    const listener = CapacitorApp.addListener('resume', () => void check());
    return () => {
      active = false;
      void listener.then((handle) => handle.remove());
    };
  }, [appleUser]);

  return null;
}
