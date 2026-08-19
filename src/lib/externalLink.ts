import { isNative } from '@/lib/native';

/**
 * Opens an external (non-Afiyeat) URL - a Ticketmaster event page, etc.
 * Uses the in-app browser on native so the user isn't fully kicked out of
 * the app, falling back to a normal new-tab window.open on web. Same
 * open-a-URL logic as getDirections() in lib/directions.ts, pulled out
 * here as a general-purpose helper rather than something maps-specific.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isNative()) {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
      return;
    } catch (err) {
      console.error('Browser.open failed, falling back to window.open:', err);
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
