import { Capacitor } from '@capacitor/core';

export const isNative = (): boolean => Capacitor.isNativePlatform();

// Note: CapacitorUpdater.notifyAppReady() - telling Capgo's live-update
// plugin that this launch succeeded - is called directly in main.tsx
// (added by Capgo's own CLI onboarding), as early as possible at module
// load time, before React even mounts. Safe to call unconditionally on
// web too - the plugin's web implementation is a harmless no-op there.

export async function initPushNotifications(
  onToken?: (token: string) => void | Promise<void>,
): Promise<void> {
  if (!isNative()) return;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return;
    // This can legitimately run more than once per app session (e.g. the
    // auth listener firing SIGNED_IN again on token refresh), and each call
    // used to stack a fresh pair of listeners on top of any still attached
    // from a previous call - so a single real token event would fire the
    // (Supabase-upserting) callback once per past call, growing over the
    // session. Clear out anything previously attached first.
    await PushNotifications.removeAllListeners();
    // Listeners must be attached before register() is called - otherwise the
    // native 'registration' event (with the token) can fire and resolve
    // before the JS side is listening for it, silently dropping the token
    // and leaving device_tokens empty even though registration "succeeded".
    PushNotifications.addListener('registration', (token) => {
      void onToken?.(token.value);
    });
    PushNotifications.addListener('registrationError', (err) => {
      console.error('Push registration error:', err);
    });
    await PushNotifications.register();
  } catch (err) {
    console.error('initPushNotifications failed:', err);
  }
}

export async function requestLocationPermission(): Promise<boolean> {
  if (!isNative()) return true;
  try {
    const { Geolocation } = await import('@capacitor/geolocation');
    // Check first, rather than unconditionally calling requestPermissions()
    // every time this runs (e.g. on every app launch, from
    // requestStartupPermissions). iOS's own system prompt only ever shows
    // once regardless, but checking first avoids the redundant native call
    // on every subsequent launch, and - more importantly - means a user who
    // already said no isn't hit with any of our own UI again either, since
    // callers use this same status to decide whether to show a reminder.
    const current = await Geolocation.checkPermissions();
    if (current.location === 'granted' || current.coarseLocation === 'granted') return true;
    if (current.location === 'denied' && current.coarseLocation === 'denied') return false;
    const perm = await Geolocation.requestPermissions();
    return perm.location === 'granted' || perm.coarseLocation === 'granted';
  } catch (err) {
    console.error('requestLocationPermission failed:', err);
    return false;
  }
}

export async function requestCameraPermission(): Promise<boolean> {
  if (!isNative()) return true;
  try {
    const { Camera } = await import('@capacitor/camera');
    const perm = await Camera.requestPermissions({ permissions: ['camera', 'photos'] });
    return perm.camera === 'granted' || perm.photos === 'granted';
  } catch (err) {
    console.error('requestCameraPermission failed:', err);
    return false;
  }
}

export async function requestStartupPermissions(
  opts: { camera?: boolean } = {},
): Promise<void> {
  if (!isNative()) return;
  await requestLocationPermission();
  if (opts.camera) await requestCameraPermission();
}

/**
 * Dismisses the native splash screen. Call this once the first real screen
 * has something to show, not on a timer.
 *
 * capacitor.config.ts sets `launchAutoHide: false`, so the splash stays up
 * until something asks it to go away. Nothing in this app ever did - the
 * only thing hiding it was Capgo's `autoSplashscreen`, which by its own
 * documentation only applies while auto-updates are enabled. With
 * auto-update now off, that prop is inert and the splash is ours to manage.
 *
 * Doing it this way is also what makes the launch feel like an app rather
 * than a page load: the splash hands over directly to populated content,
 * instead of uncovering an empty shell that then fills in.
 */
export async function hideSplashScreen(): Promise<void> {
  if (!isNative()) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch (err) {
    console.error('hideSplashScreen failed:', err);
  }
}

/**
 * Matches the status bar to the app's own surface.
 *
 * The plugin was installed but never called, leaving the status bar in
 * whatever state iOS defaulted to. Style.Light means "content for a light
 * background" (dark glyphs), which is what the warm off-white background
 * needs; the layout already reserves room for it via the pt-safe utility.
 */
export async function configureStatusBar(): Promise<void> {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Light });
  } catch (err) {
    // Not fatal, and not available on every platform - the app is
    // perfectly usable with a default status bar.
    console.error('configureStatusBar failed:', err);
  }
}

export interface Coords {
  latitude: number;
  longitude: number;
}

export async function capturePhoto(): Promise<File | null> {
  if (!isNative()) return null;
  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    const photo = await Camera.getPhoto({
      quality: 80,
      resultType: CameraResultType.Uri,
      source: CameraSource.Prompt,
    });
    if (!photo.webPath) return null;
    const blob = await (await fetch(photo.webPath)).blob();
    const ext = photo.format || 'jpg';
    return new File([blob], `photo_${Date.now()}.${ext}`, {
      type: blob.type || `image/${ext}`,
    });
  } catch (err) {
    console.warn('capturePhoto cancelled/failed:', err);
    return null;
  }
}

export async function getCurrentPosition(): Promise<Coords> {
  if (!isNative()) {
    return new Promise<Coords>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        reject,
        { enableHighAccuracy: true, timeout: 10000 },
      );
    });
  }
  const { Geolocation } = await import('@capacitor/geolocation');
  const perm = await Geolocation.requestPermissions();
  if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
    throw new Error('Location permission denied');
  }
  const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
}
