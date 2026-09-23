import { SITE_URL } from '@/lib/site';
import { shareLink, type ShareResult } from '@/lib/share';
import { withReferral } from '@/lib/passport';

export type { ShareResult };

/**
 * Shares a link to one of the user's lists via the OS share sheet.
 *
 * The link opens the list itself, not a signup page: someone without an
 * account sees a preview of the places on it (get_shared_preview) with an
 * invitation to join, and the sharer's referral code rides along so a
 * signup it produces is credited to them.
 *
 * A private-profile owner's list only opens for people who already follow
 * them - callers should tell the user (see announceShareResult).
 */
export async function shareListLink(
  userId: string,
  listId: string,
  listName: string,
  referralCode: string | null = null,
): Promise<ShareResult> {
  const url = withReferral(`${SITE_URL}/u/${userId}/lists/${listId}`, referralCode, 'custom_list');
  return shareLink({
    url,
    title: listName,
    text: `Here are the places on my "${listName}" list on Afiyeat`,
  });
}
