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
      autoUpdate: 'always',
      autoSplashscreen: true
    }
  }
};

export default config;
