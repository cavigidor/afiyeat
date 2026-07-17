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

  useEffect(() => {
    if (!user || !isNative()) return;

    let cancelled = false;
    const platform = Capacitor.getPlatform() === 'android' ? 'android' : 'ios';

    void initPushNotifications(async (token) => {
      if (cancelled) return;
      currentDeviceToken = token;
      const { error } = await supabase.from('device_tokens').upsert(
        { user_id: user.id, token, platform },
        { onConflict: 'token' },
      );
      if (error) {
        console.error('Failed to save device token:', error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  return null;
}
