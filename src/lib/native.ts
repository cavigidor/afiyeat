import { Capacitor } from '@capacitor/core';

export const isNative = (): boolean => Capacitor.isNativePlatform();

// Tells Capgo's live-update plugin that this launch succeeded. Must be
// called on every single app start, as early as possible - if a pushed
// update actually broke the app, this call never happens, and the plugin
// auto-rolls back to the last known-good bundle after a short timeout.
// A no-op on web/dev where the native plugin isn't present.
export async function notifyLiveUpdateReady(): Promise<void> {
  if (!isNative()) return;
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
    await CapacitorUpdater.notifyAppReady();
  } catch (err) {
    console.error('CapacitorUpdater.notifyAppReady failed:', err);
  }
}

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
