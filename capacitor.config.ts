import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.afiyeat.app',
  appName: 'afiyeat',
  webDir: 'dist',
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
      backgroundColor: '#ffffff',
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
