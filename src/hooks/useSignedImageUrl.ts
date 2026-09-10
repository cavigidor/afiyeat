import { useState, useEffect } from 'react';
import { getSignedUrl, peekSignedUrl } from '@/lib/storage';

/**
 * Hook to convert a public storage URL to a signed URL
 * @param url - The public URL or storage path
 * @returns Object with signedUrl and loading state
 */
export function useSignedImageUrl(url: string | null | undefined) {
  // Seed synchronously from the module-level signed-URL cache (see
  // lib/storage.ts) rather than always starting at null/loading=true. Cards
  // remount constantly (list re-renders, tab switches, navigating back) and
  // almost always ask for a URL they already resolved a moment ago - without
  // this, every single remount would show a loading spinner for one tick
  // even though the real answer was sitting in cache the whole time.
  const [signedUrl, setSignedUrl] = useState<string | null>(() => peekSignedUrl(url));
  const [loading, setLoading] = useState(() => !!url && peekSignedUrl(url) === null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchSignedUrl() {
      if (!url) {
        setSignedUrl(null);
        setLoading(false);
        return;
      }

      // Already resolved (cache hit, or not a private-bucket URL at all) -
      // peekSignedUrl already returned it into state on mount, so there's
      // no need to show a loading state or make another async call.
      const cached = peekSignedUrl(url);
      if (cached !== null) {
        setSignedUrl(cached);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const signed = await getSignedUrl(url);
        if (mounted) {
          setSignedUrl(signed);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error('Failed to get signed URL'));
          setSignedUrl(null);
          setLoading(false);
        }
      }
    }

    fetchSignedUrl();

    return () => {
      mounted = false;
    };
  }, [url]);

  return { signedUrl, loading, error };
}

/**
 * Hook to convert multiple public storage URLs to signed URLs
 * @param urls - Array of public URLs or storage paths
 * @returns Object with signedUrls array and loading state
 */
export function useSignedImageUrls(urls: (string | null | undefined)[]) {
  const [signedUrls, setSignedUrls] = useState<(string | null)[]>(() => urls.map((u) => peekSignedUrl(u)));
  const [loading, setLoading] = useState(() => urls.length > 0 && urls.some((u) => !!u && peekSignedUrl(u) === null));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchSignedUrls() {
      if (!urls || urls.length === 0) {
        setSignedUrls([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const results = await Promise.all(
          urls.map(async (url) => {
            if (!url) return null;
            
            // If it's not a recognized private-bucket storage URL, use it directly
            if (!url.includes('restaurant-images') && !url.includes('custom-list-images')) {
              return url;
            }
            
            return getSignedUrl(url);
          })
        );
        
        if (mounted) {
          setSignedUrls(results);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error('Failed to get signed URLs'));
          setSignedUrls([]);
          setLoading(false);
        }
      }
    }

    fetchSignedUrls();

    return () => {
      mounted = false;
    };
  }, [JSON.stringify(urls)]);

  return { signedUrls, loading, error };
}
