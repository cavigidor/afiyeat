import { useEffect, useState } from 'react';
import { isNative } from '@/lib/native';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  askForPushPermissionOnFirstLaunch,
  getRememberedDeviceToken,
  syncPushRegistration,
} from '@/lib/pushPermission';

/** This device's push token, if it has registered; AuthContext.signOut()
 *  removes just this row so the user's other devices keep their pushes. */
export function getCurrentDeviceToken(): string | null {
  return getRememberedDeviceToken();
}

/**
 * Notification permission and registration for this device, plus the saved
 * timezone the daily pushes are scheduled by. Renders nothing; mount once
 * near the root, inside AuthProvider.
 *
 *  - First launch: Apple's notification dialog, once (lib/pushPermission.ts).
 *  - Launch, sign-in/account switch, and every return to the foreground:
 *    registration is brought in line with the current permission - token
 *    saved if allowed, removed if not.
 */
export function PushNotificationManager() {
  const { user } = useAuth();
  const userId = user?.id;

  // Keeps profiles.timezone fresh so the daily pushes (7am fun fact, 8am and
  // 5pm exploring) go out at those times in the user's own timezone. Saved
  // on every sign-in/cold start AND whenever the app comes back to the
  // foreground, so someone who lands in a new timezone with the app still
  // in the background is picked up the next time they open it, not only
  // after a full restart. Not gated on isNative(): web sessions save a
  // timezone too. Only writes when the value actually changed.
  useEffect(() => {
    if (!userId) return;
    let lastSaved: string | null = null;
    let cancelled = false;
    let removeAppListener: (() => void) | null = null;

    const saveTimeZone = () => {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!timeZone || timeZone === lastSaved) return;
      lastSaved = timeZone;
      void supabase
        .from('profiles')
        .update({ timezone: timeZone })
        .eq('user_id', userId)
        .then(({ error }) => {
          if (error) lastSaved = null; // try again next time
        });
    };

    saveTimeZone();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') saveTimeZone();
    };
    document.addEventListener('visibilitychange', onVisibility);

    if (isNative()) {
      void import('@capacitor/app').then(async ({ App }) => {
        const handle = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) saveTimeZone();
        });
        if (cancelled) void handle.remove();
        else removeAppListener = () => void handle.remove();
      });
    }

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      removeAppListener?.();
    };
  }, [userId]);

  // First launch: Apple's dialog, once, whether or not anyone is signed in
  // yet. Then (and on every sign-in, account switch and return to the app)
  // sync this device's registration with the current permission.
  const [firstLaunchDone, setFirstLaunchDone] = useState(!isNative());
  const [foregroundCount, setForegroundCount] = useState(0);

  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;
    void askForPushPermissionOnFirstLaunch().finally(() => {
      if (!cancelled) setFirstLaunchDone(true);
    });
    let removeListener: (() => void) | null = null;
    void import('@capacitor/app').then(async ({ App }) => {
      const handle = await App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) setForegroundCount((n) => n + 1);
      });
      if (cancelled) void handle.remove();
      else removeListener = () => void handle.remove();
    });
    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, []);

  useEffect(() => {
    if (!isNative() || !firstLaunchDone) return;
    void syncPushRegistration(userId ?? null);
    // Depends on the user id, not the user object: Supabase hands back a new
    // object on every auth event (token refresh etc.) for the same account.
  }, [userId, firstLaunchDone, foregroundCount]);

  return null;
}
