import { toast } from 'sonner';

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * Opens the system share sheet for a link, falling back to copying it.
 *
 * navigator.share() is the real iOS share sheet inside the Capacitor
 * WebView - no plugin needed - and the native share sheet in modern
 * mobile browsers. Desktop browsers without it get the clipboard.
 */
export async function shareLink({
  url,
  title,
  text,
}: {
  url: string;
  title?: string;
  text?: string;
}): Promise<ShareResult> {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (err) {
      // Dismissing the share sheet is a choice, not a failure.
      if ((err as { name?: string })?.name === 'AbortError') return 'cancelled';
      console.error('navigator.share failed, falling back to clipboard:', err);
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch (err) {
    console.error('Clipboard copy failed:', err);
    return 'failed';
  }
}

/**
 * The feedback that should follow a share. The share sheet is its own
 * confirmation, so a successful native share says nothing; the clipboard
 * fallback needs telling, since nothing visible happened.
 */
export function announceShareResult(result: ShareResult, opts: { privateProfile?: boolean } = {}): void {
  if (result === 'copied') toast.success('Link copied');
  if (result === 'failed') toast.error('Couldn\'t share that link. Please try again.');
  // A private profile's content only opens for people who already follow
  // them - better to say so than let someone send a link that dead-ends.
  if ((result === 'shared' || result === 'copied') && opts.privateProfile) {
    toast.info('Your profile is private, so only people who follow you can open this link.');
  }
}
