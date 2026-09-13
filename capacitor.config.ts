import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.afiyeat.app',
  appName: 'afiyeat',
  webDir: 'dist',
  // Matches --background in index.css (light mode). Without this, the
  // native window behind the WKWebView is plain white by default, which
  // shows through as a flash on cold launch (before the web bundle has
  // painted) and, on iOS, whenever the webview's own rubber-band bounce
  // exposes the area past the content edges - a strong "this is a website"
  // tell. Keyed under `ios` (rather than only top-level) since that's what
  // actually reaches the native WKWebView + window background color.
  backgroundColor: '#F7F5F3',
  ios: {
    backgroundColor: '#F7F5F3',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: [
        'badge',
        'sound',
        'alert'
      ]
    },
    SplashScreen: {
      launchShowDuration: 1200,
      // Matches the app's own --background token (see backgroundColor
      // above) so there's no white-to-warm color flash between the splash
      // screen and the app painting its first real frame.
      backgroundColor: '#F7F5F3',
      launchAutoHide: false
    },
    CapacitorUpdater: {
      appId: 'com.afiyeat.app',
      version: '0.0.0',
      // Temporarily off (was 'always'). With 'always', the plugin checks
      // Capgo's servers on every launch and applies whatever bundle is
      // published on this app's channel there - overriding the fresh
      // native build every time, even after a full delete+reinstall. Since
      // no bundle has ever been deliberately pushed to Capgo for this app,
      // that channel is serving whatever was published back when this was
      // first set up, silently undoing every subsequent code change on
      // device. Turn this back to 'always' once bundles are actually being
      // pushed to Capgo on purpose (or leave it off if OTA updates aren't
      // needed yet) - until then, the app always runs exactly what's in
      // the native build, which is what we want while debugging.
      autoUpdate: 'off',
      autoSplashscreen: true
    }
  }
};

export default config;
