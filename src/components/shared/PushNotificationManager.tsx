import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { initPushNotifications, isNative } from '@/lib/native';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// Tracked so AuthContext.signOut() can remove just *this* device's token
// row (rather than every token belonging to the user, which would also
// knock out push on their other devices).
let currentDeviceToken: string | null = null;

export function getCurrentDeviceToken(): string | null {
  return currentDeviceToken;
}

/**
 * Registers this device and saves its token.
 *
 * `prompt: false` (the default, used on every sign-in) only registers if
 * notifications are already allowed and never shows the system dialog.
 * `prompt: true` is for lib/pushPrompt.ts, after the user has just done
 * something that makes notifications worth having.
 */
export async function registerForPush({ prompt = false }: { prompt?: boolean } = {}): Promise<void> {
  if (!isNative()) return;
  const platform = Capacitor.getPlatform() === 'android' ? 'android' : 'ios';

  await initPushNotifications(
    async (token) => {
      currentDeviceToken = token;
      // Goes through a SECURITY DEFINER RPC (not a direct table upsert) so
      // the row's owner is always taken from auth.uid() server-side, never
      // a client-supplied user_id - see the claim_device_token migration.
      const { error } = await supabase.rpc('claim_device_token', {
        p_token: token,
        p_platform: platform,
      });
      if (error) {
        console.error('Failed to save device token:', error);
      }
    },
    { prompt },
  );
}

/**
 * Registers this device for push notifications once a user is signed in,
 * and saves the resulting APNs/FCM token to public.device_tokens so a
 * backend function can look it up and send pushes later.
 *
 * Renders nothing; mount once near the root, inside AuthProvider.
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

  // Re-registers on sign-in if notifications are already allowed, so a
  // returning user's token stays fresh. Never prompts - see registerForPush.
  useEffect(() => {
    if (!userId || !isNative()) return;
    void registerForPush({ prompt: false });
    // Supabase hands back a new `session`/`user` object on every auth event
    // (initial getSession(), the auth listener's INITIAL_SESSION, a token
    // refresh, etc.) even when it's the same signed-in account - depending
    // on the object itself re-ran this effect (and re-registered for push)
    // multiple times per cold start. Depending on just the id instead means
    // it only actually re-runs on a real sign-in/sign-out/account switch.
  }, [userId]);

  return null;
}
