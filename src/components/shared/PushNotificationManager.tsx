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
 * Registers this device for push notifications once a user is signed in,
 * and saves the resulting APNs/FCM token to public.device_tokens so a
 * backend function can look it up and send pushes later.
 *
 * Renders nothing; mount once near the root, inside AuthProvider.
 */
export function PushNotificationManager() {
  const { user } = useAuth();
  const userId = user?.id;

  // Keeps profiles.timezone reasonably fresh so server-side crons (e.g. the
  // daily good-morning nudge) can fire at 8am in each user's own timezone
  // instead of one fixed UTC time for everyone. Runs on every sign-in/cold
  // start (not just push registration, and not gated on isNative() - web
  // sessions get a timezone too), so it also picks up a user traveling to
  // a new timezone next time they open the app.
  useEffect(() => {
    if (!userId) return;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timeZone) return;
    void supabase.from('profiles').update({ timezone: timeZone }).eq('user_id', userId);
  }, [userId]);

  useEffect(() => {
    if (!userId || !isNative()) return;

    let cancelled = false;
    const platform = Capacitor.getPlatform() === 'android' ? 'android' : 'ios';

    void initPushNotifications(async (token) => {
      if (cancelled) return;
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
    });

    return () => {
      cancelled = true;
    };
    // Supabase hands back a new `session`/`user` object on every auth event
    // (initial getSession(), the auth listener's INITIAL_SESSION, a token
    // refresh, etc.) even when it's the same signed-in account - depending
    // on the object itself re-ran this effect (and re-registered for push)
    // multiple times per cold start. Depending on just the id instead means
    // it only actually re-runs on a real sign-in/sign-out/account switch.
  }, [userId]);

  return null;
}
