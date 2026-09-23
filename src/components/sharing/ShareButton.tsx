import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Share2 } from 'lucide-react';
import { useMyShareIdentity } from '@/hooks/useMyShareIdentity';
import { withReferral, type ReferralSource } from '@/lib/passport';
import { announceShareResult, shareLink } from '@/lib/share';

interface ShareButtonProps {
  /** The plain content URL; the sharer's referral code is added here. */
  url: string;
  source: ReferralSource;
  title: string;
  /** The message that goes with the link - about the food, not the app. */
  text: string;
  /**
   * True when sharing your own content. If your profile is private, your
   * restaurants and lists only open for your followers, so the share says
   * so. Someone else's content is governed by their settings, not yours.
   */
  ownContent?: boolean;
  variant?: 'ghost' | 'outline';
  label?: string;
}

/**
 * Shares a restaurant, recipe or list through the iOS share sheet.
 *
 * Referral attribution rides along silently: the link is to the content
 * itself, and the sharer's code is just a query parameter on it. The
 * person sharing is sharing something good to eat; the growth loop is a
 * side effect, not the message.
 */
export function ShareButton({
  url,
  source,
  title,
  text,
  ownContent = false,
  variant = 'ghost',
  label,
}: ShareButtonProps) {
  const { referralCode, isPrivate } = useMyShareIdentity();
  const [busy, setBusy] = useState(false);

  const handleShare = async () => {
    // Guards against a double tap opening two share sheets.
    if (busy) return;
    setBusy(true);
    try {
      const result = await shareLink({ url: withReferral(url, referralCode, source), title, text });
      announceShareResult(result, { privateProfile: ownContent && isPrivate });
    } finally {
      setBusy(false);
    }
  };

  if (label) {
    return (
      <Button variant={variant} size="sm" onClick={handleShare} disabled={busy}>
        <Share2 className="h-4 w-4 mr-1.5" />
        {label}
      </Button>
    );
  }
  return (
    <Button
      variant={variant}
      size="icon"
      className="h-9 w-9"
      aria-label={`Share ${title}`}
      onClick={handleShare}
      disabled={busy}
    >
      <Share2 className="h-4 w-4" />
    </Button>
  );
}
