import { useEffect, useState } from 'react';
import { isNative } from '@/lib/native';
import { APPLE_ON_IOS, APPLE_ON_WEB, type SocialProvider } from './config';

// Which social buttons to show. The backend's public auth settings
// endpoint says which providers are switched on, so a button appears only
// once its provider has been configured in Lovable Cloud - merging this
// code before the setup is finished shows nothing new and breaks nothing.
//
// The last answer is remembered so the buttons don't pop in late on the
// next visit; a fresh answer replaces it in the background.

const CACHE_KEY = 'afiyeat-auth-providers';
const TIMEOUT_MS = 5000;

export interface EnabledProviders {
  apple: boolean;
  google: boolean;
}

const NONE: EnabledProviders = { apple: false, google: false };

/** Reads GoTrue's /settings response. Anything unexpected means "off". */
export function parseAuthSettings(body: unknown): EnabledProviders {
  const external = (body as { external?: Record<string, unknown> } | null)?.external;
  if (!external || typeof external !== 'object') return NONE;
  return { apple: external.apple === true, google: external.google === true };
}

/** Applies where each provider can run on this platform. */
export function visibleProviders(
  enabled: EnabledProviders,
  platform: { native: boolean; appleOnWeb: boolean; appleOnIos: 'native' | 'browser' },
): SocialProvider[] {
  const list: SocialProvider[] = [];
  // Apple first: App Store guideline 4.8 wants it offered at least as
  // prominently as any other third-party sign-in.
  if (enabled.apple && (platform.native || platform.appleOnWeb)) list.push('apple');
  if (enabled.google) list.push('google');
  return list;
}

function readCache(): EnabledProviders | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as EnabledProviders;
    return { apple: value.apple === true, google: value.google === true };
  } catch {
    return null;
  }
}

function writeCache(value: EnabledProviders): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    /* not worth failing over */
  }
}

let inflight: Promise<EnabledProviders | null> | null = null;

export function fetchEnabledProviders(): Promise<EnabledProviders | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`, {
        headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const value = parseAuthSettings(await res.json());
      writeCache(value);
      return value;
    } catch {
      return null;
    } finally {
      window.clearTimeout(timer);
      inflight = null;
    }
  })();
  return inflight;
}

/** Social providers to offer on this screen, in display order. */
export function useSocialProviders(): SocialProvider[] {
  const [enabled, setEnabled] = useState<EnabledProviders>(() => readCache() ?? NONE);

  useEffect(() => {
    let active = true;
    void fetchEnabledProviders().then((value) => {
      if (active && value) setEnabled(value);
    });
    return () => {
      active = false;
    };
  }, []);

  return visibleProviders(enabled, { native: isNative(), appleOnWeb: APPLE_ON_WEB, appleOnIos: APPLE_ON_IOS });
}
