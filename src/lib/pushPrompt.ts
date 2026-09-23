import { toast } from 'sonner';
import { isNative } from '@/lib/native';
import { registerForPush } from '@/components/shared/PushNotificationManager';

/**
 * Whether the app should offer notifications at all.
 *
 * OFF until push delivery is confirmed end to end. Sending depends on an
 * `internal_push_secret` row in private.secrets and three APNs secrets on
 * the send-push function (APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID), and none of
 * those have been confirmed as set. Asking someone to allow notifications
 * for a feature that then silently never fires is worse than not asking:
 * it spends the one chance iOS gives you to ask, on nothing.
 *
 * Flip to true once a test notification has actually arrived on a device.
 * Users who already allowed notifications keep registering regardless.
 */
export const PUSH_PROMPT_ENABLED = false;

const OFFERED_KEY = 'afiyeat.push_offer_shown';

/**
 * Offers notifications right after the user follows someone, which is the
 * first moment they're obviously useful ("tell me when they follow back").
 *
 * Shown as a toast with a button rather than the system dialog directly:
 * iOS only ever shows its dialog once, so the app asks in its own words
 * first, and the system dialog appears only for someone who has already
 * said yes. Offered once per device, ever.
 */
export async function offerPushAfterFollow({ pending }: { pending: boolean }): Promise<void> {
  if (!PUSH_PROMPT_ENABLED || !isNative()) return;

  try {
    if (localStorage.getItem(OFFERED_KEY)) return;
  } catch {
    return;
  }

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.checkPermissions();
    // Already decided either way - nothing to offer.
    if (perm.receive !== 'prompt' && perm.receive !== 'prompt-with-rationale') return;
  } catch {
    return;
  }

  try {
    localStorage.setItem(OFFERED_KEY, '1');
  } catch {
    /* worst case the offer can appear once more */
  }

  toast(pending ? 'Want to know when they accept?' : 'Want to know when they follow back?', {
    description: 'Afiyeat can send you a notification.',
    duration: 10000,
    action: {
      label: 'Turn on',
      onClick: () => {
        void registerForPush({ prompt: true });
      },
    },
  });
}
