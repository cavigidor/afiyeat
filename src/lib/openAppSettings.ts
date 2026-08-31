import { isNative } from './native';

// Deep-links into this app's page in the system Settings app. Relies on the
// well-known "app-settings:" URL scheme (the same one
// UIApplication.openSettingsURLString resolves to under the hood) rather
// than a dedicated native settings plugin - that avoids pulling in a whole
// new Capacitor plugin (npm install + cap sync + an Xcode rebuild) just for
// one deep link, using the @capacitor/app dependency the app already has.
// Apple has kept this scheme working for years, but it's still not
// officially documented API, so callers should pair this with plain-text
// "Settings > Afiyeat > Location" instructions in case it silently no-ops
// on some future iOS version.
export async function openAppSettings(): Promise<void> {
  if (!isNative()) return;
  try {
    const { App } = await import('@capacitor/app');
    await App.openUrl({ url: 'app-settings:' });
  } catch (err) {
    console.error('openAppSettings failed:', err);
  }
}
