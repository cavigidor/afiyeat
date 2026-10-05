import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { clearSignedUrlCache } from '@/lib/storage';

/**
 * Keeps one account's data from leaking into the next session on the
 * same device.
 *
 * The app holds a lot of per-account state in memory: the React Query
 * cache (10-minute gcTime), signed image URLs, and the four persistent
 * tabs, which stay mounted with their own state. Without this, signing
 * out and signing in as someone else could briefly show the previous
 * person's lists, photos or follow requests until each query refetched.
 *
 * When the signed-in account changes (sign-out, or a different account
 * signing in), this:
 *   1. cancels in-flight requests so a late response for the old account
 *      can't write itself back into the cache,
 *   2. drops every cached query and signed image URL,
 *   3. remounts its children, so tab state, scroll positions and open
 *      dialogs start fresh.
 *
 * Signing in from a signed-out state clears the cache but doesn't remount:
 * there is no previous account's UI to throw away, and remounting there
 * would interrupt the sign-in screen's own redirect.
 */
export function AccountBoundary({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const userId = loading ? undefined : user?.id ?? null;

  // undefined = auth hasn't resolved yet, null = signed out.
  const previousId = useRef<string | null | undefined>(undefined);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (userId === undefined) return;
    const prev = previousId.current;
    previousId.current = userId;

    // First resolution after launch, or no change: nothing to clear.
    if (prev === undefined || prev === userId) return;

    void queryClient.cancelQueries();
    queryClient.clear();
    clearSignedUrlCache();

    if (prev !== null) {
      setGeneration((g) => g + 1);
      window.scrollTo(0, 0);
    }
  }, [userId, queryClient]);

  // For the single render between the account changing and the effect
  // above running, render nothing rather than the previous account's
  // screens with the new account's identity.
  const prev = previousId.current;
  const switchingAway = userId !== undefined && prev != null && prev !== userId;
  if (switchingAway) return null;

  return <Fragment key={generation}>{children}</Fragment>;
}
