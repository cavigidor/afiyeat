import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { isNative } from '@/lib/native';

// Hosts and paths the iOS app accepts from Universal Links. They must
// match public/.well-known/apple-app-site-association and the
// associated-domains entitlement in ios/App/App/App.entitlements.
const HOSTS = new Set(['afiyeat.com', 'www.afiyeat.com']);
const PATHS = [
  /^\/r\/[0-9a-f-]{36}\/?$/i,
  /^\/recipe\/[0-9a-f-]{36}\/?$/i,
  /^\/u\/[0-9a-f-]{36}(\/lists\/[0-9a-f-]{36})?\/?$/i,
  /^\/invite\/[A-Za-z0-9]{4,12}\/?$/,
];

/** The in-app route for an afiyeat.com link, or null if it isn't one we open. */
export function routeForLink(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !HOSTS.has(parsed.hostname.toLowerCase())) return null;
  if (!PATHS.some((re) => re.test(parsed.pathname))) return null;
  // Keep the query: it carries the referral code (?ref=…) that
  // ReferralCapture reads once the route renders.
  return parsed.pathname + parsed.search;
}

/**
 * Opens afiyeat.com links inside the app (Universal Links).
 *
 * iOS hands the app the tapped URL in two ways: at launch, when the link
 * started the app (getLaunchUrl), and as an appUrlOpen event when the app
 * was already running. Both go through routeForLink, so only known screens
 * on our own domain are ever navigated to - never an arbitrary URL.
 */
export function NativeLinkRouter() {
  const navigate = useNavigate();
  const lastHandled = useRef<{ url: string; at: number } | null>(null);

  useEffect(() => {
    if (!isNative()) return;
    let removed = false;
    let remove: (() => void) | undefined;

    const open = (url: string | undefined | null) => {
      if (!url) return;
      // iOS can deliver the same link through both paths on a cold start.
      const now = Date.now();
      if (lastHandled.current && lastHandled.current.url === url && now - lastHandled.current.at < 3000) return;
      const route = routeForLink(url);
      if (!route) return;
      lastHandled.current = { url, at: now };
      navigate(route);
    };

    void (async () => {
      const { App } = await import('@capacitor/app');
      const launch = await App.getLaunchUrl().catch(() => undefined);
      open(launch?.url);
      const handle = await App.addListener('appUrlOpen', (event) => open(event.url));
      if (removed) void handle.remove();
      else remove = () => void handle.remove();
    })();

    return () => {
      removed = true;
      remove?.();
    };
  }, [navigate]);

  return null;
}
