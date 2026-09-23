import { useEffect } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  clearReturnTo,
  isPlausibleReferralCode,
  peekReturnTo,
  setReturnTo,
  storePendingReferral,
  type ReferralSource,
} from '@/lib/passport';

// Shared-content URLs, and what each one points at. Used to record which
// kind of content brought someone to Afiyeat, so we can later see whether
// recipes, restaurants or lists actually produce new users.
const CONTENT_ROUTES: { pattern: string; contentType: string; source: ReferralSource; idParam: string }[] = [
  { pattern: '/r/:id', contentType: 'restaurant', source: 'restaurant', idParam: 'id' },
  { pattern: '/recipe/:id', contentType: 'recipe', source: 'recipe', idParam: 'id' },
  { pattern: '/u/:userId/lists/:listId', contentType: 'custom_list', source: 'custom_list', idParam: 'listId' },
  { pattern: '/u/:userId', contentType: 'profile', source: 'profile', idParam: 'userId' },
];

const SOURCES: ReferralSource[] = ['invite_link', 'restaurant', 'custom_list', 'recipe', 'profile', 'shared_list', 'other'];

/**
 * Picks the referral code off any shared link (…?ref=CODE&ref_src=…) and
 * parks it until the visitor has an account, along with where they were -
 * so after signing up they come back to the thing they were sent.
 *
 * Mounted once inside the router. Renders nothing.
 */
export function ReferralCapture() {
  const location = useLocation();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || user) return; // Only people who might sign up matter here.
    const params = new URLSearchParams(location.search);
    const code = params.get('ref');
    if (!isPlausibleReferralCode(code)) return;

    const rawSource = params.get('ref_src') as ReferralSource | null;
    const route = CONTENT_ROUTES.map((r) => ({ r, m: matchPath(r.pattern, location.pathname) })).find(
      (x) => x.m,
    );

    storePendingReferral({
      code,
      source: rawSource && SOURCES.includes(rawSource) ? rawSource : route?.r.source ?? 'other',
      contentType: route?.r.contentType,
      contentId: route?.m?.params[route.r.idParam],
      returnTo: location.pathname,
    });
    setReturnTo(location.pathname);
  }, [location.pathname, location.search, user, loading]);

  // Once a signed-in user has actually landed back on the content, the
  // return path has done its job.
  useEffect(() => {
    if (!user) return;
    if (peekReturnTo() === location.pathname) clearReturnTo();
  }, [user, location.pathname]);

  return null;
}
