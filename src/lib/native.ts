import { Capacitor } from '@capacitor/core';

export const isNative = (): boolean => Capacitor.isNativePlatform();

/**
 * Registers this device for push and hands the token to `onToken`.
 *
 * By default this never shows the system permission prompt: it only
 * registers if the user has already said yes. It used to prompt on every
 * sign-in, which meant a brand-new user's first moment in the app was an
 * iOS dialog asking to send notifications before they'd seen anything -
 * exactly what Apple asks apps not to do, and a reliable way to collect a
 * "Don't Allow" that can never be asked again. Pass `prompt: true` only in
 * response to something the user just did (see lib/pushPrompt.ts).
 */
export async function initPushNotifications(
  onToken?: (token: string) => void | Promise<void>,
  opts: { prompt?: boolean } = {},
): Promise<void> {
  if (!isNative()) return;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      if (!opts.prompt) return;
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

// There is intentionally no "request permissions at startup" helper here any
// more. The app used to ask for location on every cold launch, before the
// user had done anything that needed it. Every permission is now requested
// at the moment its feature is used:
//   - location: opening a map, tapping Near Me, searching for a place, or
//     opening Explore (see useLocationPermission / getCurrentPosition)
//   - camera/photos: choosing to add a photo (the Camera plugin prompts
//     itself inside capturePhoto)
//   - notifications: offered after following someone (lib/pushPrompt.ts)
// Screens that merely benefit from location, rather than being about it,
// use getCurrentPositionIfGranted() below, which never prompts.

/**
 * Dismisses the native splash screen. Call this once the first real screen
 * has something to show, not on a timer.
 *
 * capacitor.config.ts sets `launchAutoHide: false`, so the splash stays up
 * until something asks it to go away - this is the only thing that does.
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

export type PushPermission = 'granted' | 'denied' | 'not-asked' | 'unsupported';

/** This device's notification permission, without ever prompting. */
export async function getPushPermission(): Promise<PushPermission> {
  if (!isNative()) return 'unsupported';
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const { receive } = await PushNotifications.checkPermissions();
    if (receive === 'granted') return 'granted';
    if (receive === 'denied') return 'denied';
    return 'not-asked';
  } catch {
    return 'unsupported';
  }
}

export type GalleryPick =
  | { status: 'picked'; files: File[] }
  | { status: 'cancelled' }
  | { status: 'unavailable' };

/**
 * Opens the iPhone's own photo picker with a hard cap on how many photos
 * can be selected (iOS greys out the rest and shows "Select up to N").
 *
 * With a plain <input type="file" multiple>, iOS lets people select any
 * number of photos and converts every one of them before the app even sees
 * them, so picking 12 photos meant a long wait just to be told "max 5".
 * Here the picker itself stops at `limit`, and photos come back already
 * resized to 1600px JPEGs, so they're quick to hand over.
 *
 * Uses Camera.pickImages: deprecated in @capacitor/camera 8 in favour of
 * chooseFromGallery, but pickImages is the one that uses Apple's standard
 * picker (PHPicker, no photo-library permission prompt) and resizes
 * natively. Revisit when upgrading the plugin.
 *
 * 'unavailable' means the native picker couldn't be used (web, or the
 * plugin failed); callers fall back to the file input.
 */
export async function pickGalleryPhotos(limit: number): Promise<GalleryPick> {
  if (!isNative() || limit <= 0) return { status: 'unavailable' };
  try {
    const { Camera } = await import('@capacitor/camera');
    const { photos } = await Camera.pickImages({
      limit,
      quality: 82,
      width: 1600,
      height: 1600,
      correctOrientation: true,
    });
    const files: File[] = [];
    // Older Android ignores `limit`; the caller's own count check still
    // rejects an over-limit selection with the error message.
    for (const [i, photo] of photos.entries()) {
      const blob = await (await fetch(photo.webPath)).blob();
      const ext = photo.format || 'jpeg';
      files.push(
        new File([blob], `photo_${Date.now()}_${i}.${ext === 'jpeg' ? 'jpg' : ext}`, {
          type: blob.type || `image/${ext}`,
        }),
      );
    }
    return { status: 'picked', files };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/cancel/i.test(message)) return { status: 'cancelled' };
    console.warn('pickGalleryPhotos failed, falling back to file input:', err);
    return { status: 'unavailable' };
  }
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

/**
 * The user's position if they've already allowed location, otherwise null.
 * Never shows a permission prompt.
 *
 * For screens that merely benefit from location rather than being about
 * it - picking a default news city, say. Asking there would put a system
 * dialog in front of someone on their very first screen, for a convenience
 * they never asked for.
 */
export async function getCurrentPositionIfGranted(): Promise<Coords | null> {
  try {
    if (!isNative()) {
      // Browsers without the Permissions API would prompt on
      // getCurrentPosition, so treat "can't tell" as "not granted".
      if (!navigator.permissions?.query) return null;
      const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
      if (status.state !== 'granted') return null;
      return await getCurrentPosition();
    }
    const { Geolocation } = await import('@capacitor/geolocation');
    const perm = await Geolocation.checkPermissions();
    if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') return null;
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 10000 });
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch {
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
