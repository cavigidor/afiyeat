import { Capacitor } from '@capacitor/core';

export const isNative = (): boolean => Capacitor.isNativePlatform();

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
    await PushNotifications.register();
    PushNotifications.addListener('registration', (token) => {
      void onToken?.(token.value);
    });
    PushNotifications.addListener('registrationError', (err) => {
      console.error('Push registration error:', err);
    });
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
