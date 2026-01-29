import { useState, useEffect } from 'react';
import { getSignedUrl } from '@/lib/storage';

/**
 * Hook to convert a public storage URL to a signed URL
 * @param url - The public URL or storage path
 * @returns Object with signedUrl and loading state
 */
export function useSignedImageUrl(url: string | null | undefined) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchSignedUrl() {
      if (!url) {
        setSignedUrl(null);
        setLoading(false);
        return;
      }

      // If it's not a storage URL, use it directly
      if (!url.includes('restaurant-images')) {
        setSignedUrl(url);
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
  const [signedUrls, setSignedUrls] = useState<(string | null)[]>([]);
  const [loading, setLoading] = useState(true);
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
            
            // If it's not a storage URL, use it directly
            if (!url.includes('restaurant-images')) {
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
