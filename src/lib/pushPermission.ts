import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { getPushPermission, isNative, type PushPermission } from '@/lib/native';

/**
 * Notification permission and this device's registration.
 *
 * PM decision 2026-11-18:
 *  - On the very first launch, show Apple's own notification dialog, once.
 *    No Afiyeat screen before it, no explanation popup, no "Not now" screen.
 *  - Never show it again. If the person chose Don't Allow, the app only ever
 *    points them to iPhone Settings (Profile > Notifications).
 *  - A device whose permission isn't granted must not keep a token on the
 *    server, so nothing (daily or social) is sent to it. The token is removed
 *    on the next launch / return to the app after permission goes away.
 *  - Allowing notifications is NOT consent to the daily engagement pushes
 *    (7am, 8am, 5pm). Those need a separate opt-in in Profile > Notifications
 *    - see lib/notificationPreferences.ts - and the server checks that
 *    consent itself, so a registered device on its own receives only social
 *    notifications (follows, shared lists).
 */

const ASKED_KEY = 'afiyeat.push_permission_asked';
const TOKEN_KEY = 'afiyeat.push_device_token';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: worst case we re-check next launch */
  }
}

/** The token this device last registered, kept across launches so it can be
 *  removed from the server on sign-out or when permission is turned off. */
export function getRememberedDeviceToken(): string | null {
  return readStorage(TOKEN_KEY);
}

/**
 * First launch only: shows Apple's notification dialog. Does nothing if iOS
 * already has an answer (Allow or Don't Allow), or if this install has asked
 * before. Returns the permission afterwards.
 */
export async function askForPushPermissionOnFirstLaunch(): Promise<PushPermission> {
  if (!isNative()) return 'unsupported';
  const current = await getPushPermission();
  if (current !== 'not-asked' || readStorage(ASKED_KEY)) return current;

  // Record the ask before showing the dialog, so a crash or a force-quit
  // while it's up can't lead to a second ask on the next launch.
  writeStorage(ASKED_KEY, new Date().toISOString());
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const { receive } = await PushNotifications.requestPermissions();
    return receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'not-asked';
  } catch (err) {
    console.error('Notification permission request failed:', err);
    return getPushPermission();
  }
}

/**
 * Shows Apple's dialog from Profile > Notifications, but only if iOS has
 * never had an answer from this person (for example the first-launch ask
 * didn't happen). After Don't Allow, iOS won't show it again anyway; the
 * card offers iPhone Settings instead.
 */
export async function askForPushPermissionFromSettings(): Promise<PushPermission> {
  if (!isNative()) return 'unsupported';
  const current = await getPushPermission();
  if (current !== 'not-asked') return current;
  writeStorage(ASKED_KEY, new Date().toISOString());
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const { receive } = await PushNotifications.requestPermissions();
    return receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'not-asked';
  } catch {
    return getPushPermission();
  }
}

async function removeThisDeviceToken(): Promise<void> {
  const token = getRememberedDeviceToken();
  if (!token) return;
  // Deleting by the token value only ever matches this device's row, and RLS
  // only lets a signed-in user delete their own rows. If nobody is signed in
  // the delete matches nothing; the row is removed by the next launch with a
  // session, or replaced when someone signs in (claim_device_token).
  const { error } = await supabase.from('device_tokens').delete().eq('token', token);
  if (!error) writeStorage(TOKEN_KEY, null);
}

/**
 * Brings this device's server registration in line with the current iOS
 * permission. Call on launch, on sign-in and whenever the app returns to the
 * foreground (the person may have changed it in iPhone Settings meanwhile).
 *
 *  - permission granted and signed in -> register and save the token
 *    (claim_device_token, which also moves the token from any previous
 *    account on this phone to this one)
 *  - anything else -> remove this device's token, so nothing is sent to it
 */
export async function syncPushRegistration(userId: string | null): Promise<PushPermission> {
  if (!isNative()) return 'unsupported';
  const permission = await getPushPermission();

  if (permission !== 'granted') {
    if (userId) await removeThisDeviceToken();
    return permission;
  }
  if (!userId) return permission;

  const platform = Capacitor.getPlatform() === 'android' ? 'android' : 'ios';
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    // Listeners first (a fast 'registration' event can otherwise be missed),
    // and cleared first so repeated syncs don't stack them.
    await PushNotifications.removeAllListeners();
    await PushNotifications.addListener('registration', async ({ value }) => {
      const { error } = await supabase.rpc('claim_device_token', { p_token: value, p_platform: platform });
      if (error) console.error('Failed to save device token:', error);
      else writeStorage(TOKEN_KEY, value);
    });
    await PushNotifications.addListener('registrationError', (err) => {
      console.error('Push registration error:', err);
    });
    await PushNotifications.register();
  } catch (err) {
    console.error('Push registration failed:', err);
  }
  return permission;
}

/** Opens Afiyeat's page in iPhone Settings (Notifications is on it). */
export function openIPhoneSettings(): void {
  // Capacitor hands non-app URLs to iOS (UIApplication.open); app-settings:
  // is Apple's URL for this app's own Settings page.
  window.location.href = 'app-settings:';
}
