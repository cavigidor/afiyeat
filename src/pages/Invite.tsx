import { useEffect } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  isSafeInternalPath,
  setReturnTo,
  storePendingReferral,
  type ReferralSource,
} from '@/lib/passport';

/**
 * /invite/:code
 *
 * Parks the invite code and sends the visitor onward. It renders nothing
 * itself: an interstitial "you've been invited!" page is a speed bump
 * between someone and the reason they tapped the link.
 *
 * Signed out -> sign-up, where the code is claimed once an account
 * exists. Already signed in -> straight into the app; claim_referral will
 * reject the attribution server-side (the account isn't new), which is
 * the correct outcome rather than something to handle here.
 */
export default function Invite() {
  const { code } = useParams<{ code: string }>();
  const [params] = useSearchParams();
  const { user, loading } = useAuth();

  const source = (params.get('ref_src') as ReferralSource | null) ?? 'invite_link';
  // `next` comes from the URL, so it's only honoured if it's a path inside
  // this app - never an external address.
  const next = params.get('next');
  const returnTo = isSafeInternalPath(next) ? next : undefined;

  useEffect(() => {
    if (!code || user) return;
    storePendingReferral({
      code,
      source,
      contentType: params.get('ct') ?? undefined,
      contentId: params.get('ci') ?? undefined,
      returnTo,
    });
    if (returnTo) setReturnTo(returnTo);
  }, [code, source, returnTo, params, user]);

  if (loading) return null;
  if (!code) return <Navigate to="/" replace />;

  if (user) {
    return <Navigate to={returnTo ?? '/foodie'} replace />;
  }
  return <Navigate to="/auth?mode=signup" replace />;
}
