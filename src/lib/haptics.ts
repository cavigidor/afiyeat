import { isNative } from '@/lib/native';

// Thin, safe wrapper around @capacitor/haptics - every call is a no-op on
// web and swallows any native error, so call sites never need their own
// isNative()/try-catch just to add a touch of tactile feedback. Kept to a
// small, deliberate set of moments (see call sites) rather than every tap -
// overusing haptics reads as noisy rather than polished.

/** A light tick - for a lightweight, frequent confirmation (e.g. switching
 *  bottom tabs). */
export async function hapticTap(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    // Haptics engine unavailable/unsupported - not worth surfacing.
  }
}

/** A slightly firmer bump - for a deliberate, positive action completing
 *  (e.g. marking a place visited, adding something to a list). */
export async function hapticSuccess(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, NotificationType } = await import('@capacitor/haptics');
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    // Haptics engine unavailable/unsupported - not worth surfacing.
  }
}

/** A distinct warning buzz - for a destructive action (e.g. deleting a
 *  restaurant or list item). */
export async function hapticWarning(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, NotificationType } = await import('@capacitor/haptics');
    await Haptics.notification({ type: NotificationType.Warning });
  } catch {
    // Haptics engine unavailable/unsupported - not worth surfacing.
  }
}
