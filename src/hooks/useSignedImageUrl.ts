import { useState, useEffect, useCallback } from 'react';
import { forgetSignedUrl, getSignedUrl, peekSignedUrl, resolveImageUrl, type ImageBucket, type SignFailure } from '@/lib/storage';

/**
 * Hook to turn a stored image value (public-URL-shaped link, bare storage
 * path, or external URL - see parseStorageRef) into a loadable URL.
 * @param url - The stored image value
 * @param bucket - Bucket a bare storage path lives in (defaults to restaurant-images)
 * @returns signedUrl and loading state, why signing failed (if it did), and
 *   retry(), which drops the cached signature and signs again
 */
export function useSignedImageUrl(url: string | null | undefined, bucket?: ImageBucket) {
  // Seed synchronously from the module-level signed-URL cache (see
  // lib/storage.ts) rather than always starting at null/loading=true. Cards
  // remount constantly (list re-renders, tab switches, navigating back) and
  // almost always ask for a URL they already resolved a moment ago - without
  // this, every single remount would show a loading spinner for one tick
  // even though the real answer was sitting in cache the whole time.
  const [signedUrl, setSignedUrl] = useState<string | null>(() => peekSignedUrl(url, bucket));
  const [loading, setLoading] = useState(() => !!url && peekSignedUrl(url, bucket) === null);
  const [error, setError] = useState<Error | null>(null);
  const [failure, setFailure] = useState<SignFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function fetchSignedUrl() {
      if (!url) {
        setSignedUrl(null);
        setFailure(null);
        setLoading(false);
        return;
      }

      // Already resolved (cache hit, or not a private-bucket URL at all) -
      // no need to show a loading state or make another async call.
      const cached = peekSignedUrl(url, bucket);
      if (cached !== null) {
        setSignedUrl(cached);
        setFailure(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setFailure(null);

      try {
        const result = await resolveImageUrl(url, bucket);
        if (mounted) {
          setSignedUrl(result.url);
          setFailure(result.url ? null : result.failure);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error('Failed to get signed URL'));
          setSignedUrl(null);
          setFailure('error');
          setLoading(false);
        }
      }
    }

    fetchSignedUrl();

    return () => {
      mounted = false;
    };
  }, [url, bucket, attempt]);

  const retry = useCallback(() => {
    forgetSignedUrl(url, bucket);
    setAttempt((n) => n + 1);
  }, [url, bucket]);

  return { signedUrl, loading, error, failure, retry };
}

/**
 * Hook to convert multiple stored image values to loadable URLs
 * @param urls - Array of stored image values
 * @param bucket - Bucket bare storage paths live in (defaults to restaurant-images)
 * @returns Object with signedUrls array (null where signing failed) and loading state
 */
export function useSignedImageUrls(urls: (string | null | undefined)[], bucket?: ImageBucket) {
  const [signedUrls, setSignedUrls] = useState<(string | null)[]>(() => urls.map((u) => peekSignedUrl(u, bucket)));
  const [loading, setLoading] = useState(
    () => urls.length > 0 && urls.some((u) => !!u && peekSignedUrl(u, bucket) === null),
  );
  const [error, setError] = useState<Error | null>(null);
  const key = JSON.stringify(urls);

  useEffect(() => {
    let mounted = true;
    const list: (string | null | undefined)[] = JSON.parse(key);

    async function fetchSignedUrls() {
      if (list.length === 0) {
        setSignedUrls([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const results = await Promise.all(list.map((url) => getSignedUrl(url, bucket)));
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
  }, [key, bucket]);

  return { signedUrls, loading, error };
}
