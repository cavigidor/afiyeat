import { SITE_URL } from '@/lib/site';

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * Shares a link to a public list (a custom list, or in future anything
 * else reachable at this shape of URL) via the OS share sheet.
 *
 * navigator.share() works inside a Capacitor WKWebView on iOS without any
 * plugin - no @capacitor/share dependency needed. Falls back to copying
 * the link to the clipboard on platforms/browsers without it.
 *
 * Note: whoever opens this link still goes through the normal
 * custom_lists RLS (owner, public profile, or an accepted follower) - a
 * private-profile owner sharing this link only actually works for people
 * who already follow them. Callers should surface that to the user
 * separately rather than this function silently producing a dead link.
 */
export async function shareListLink(
  userId: string,
  listId: string,
  listName: string,
): Promise<ShareResult> {
  const url = `${SITE_URL}/u/${userId}/lists/${listId}`;

  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title: listName, text: `Check out my "${listName}" list on Afiyeat`, url });
      return 'shared';
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        return 'cancelled';
      }
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
