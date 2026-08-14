import { supabase } from '@/integrations/supabase/client';

// Cache for signed URLs to reduce API calls
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const CACHE_BUFFER_MS = 5 * 60 * 1000; // 5 minutes buffer before expiry

// Every private image bucket in the app - both need signing since both
// were created (or later switched to, in restaurant-images's case) private.
const IMAGE_BUCKETS = ['restaurant-images', 'custom-list-images'] as const;
type ImageBucket = (typeof IMAGE_BUCKETS)[number];

/**
 * Extracts the bucket + storage path from a full public URL.
 * @param url - The full URL (public or signed)
 * @returns The bucket and path, or null if not a valid storage URL
 */
export function extractStoragePath(url: string): { bucket: ImageBucket; path: string } | null {
  if (!url) return null;

  // Handle already-signed URLs (they contain /object/sign/)
  if (url.includes('/object/sign/')) {
    return null; // Already a signed URL, can't extract path
  }

  // Handle public-URL-shaped links like:
  // https://xxx.supabase.co/storage/v1/object/public/<bucket>/path
  for (const bucket of IMAGE_BUCKETS) {
    const match = url.match(new RegExp(`/storage/v1/object/public/${bucket}/(.+?)(\\?|$)`));
    if (match) {
      return { bucket, path: match[1] };
    }
  }

  return null;
}

/**
 * Gets a signed URL for a storage path, with caching.
 * @param bucket - Which storage bucket the path lives in
 * @param path - The storage path within that bucket
 * @param expiresIn - Expiry time in seconds (default 1 hour)
 * @returns The signed URL or null on error
 */
export async function getSignedImageUrl(
  bucket: ImageBucket,
  path: string,
  expiresIn: number = 3600
): Promise<string | null> {
  if (!path) return null;

  const cacheKey = `${bucket}/${path}`;
  const cached = signedUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + CACHE_BUFFER_MS) {
    return cached.url;
  }

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);

    if (error) {
      console.error('Error creating signed URL:', error);
      return null;
    }

    signedUrlCache.set(cacheKey, {
      url: data.signedUrl,
      expiresAt: Date.now() + expiresIn * 1000,
    });

    return data.signedUrl;
  } catch (error) {
    console.error('Error getting signed URL:', error);
    return null;
  }
}

/**
 * Converts a public URL or storage path to a signed URL. Recognizes URLs
 * from any bucket in IMAGE_BUCKETS; anything else is returned unchanged.
 * @param urlOrPath - The public URL or storage path
 * @returns The signed URL or null on error
 */
export async function getSignedUrl(urlOrPath: string | null | undefined): Promise<string | null> {
  if (!urlOrPath) return null;

  // If it's already a signed URL, return it (but it might be expired)
  if (urlOrPath.includes('/object/sign/')) {
    return urlOrPath;
  }

  const extracted = extractStoragePath(urlOrPath);
  if (!extracted) {
    // Not a recognized storage URL, return original
    return urlOrPath;
  }

  return getSignedImageUrl(extracted.bucket, extracted.path);
}

/**
 * Batch get signed URLs for multiple images
 * @param urls - Array of public URLs or storage paths
 * @returns Array of signed URLs (null for failed conversions)
 */
export async function getSignedUrls(
  urls: (string | null | undefined)[]
): Promise<(string | null)[]> {
  return Promise.all(urls.map(url => getSignedUrl(url)));
}

/**
 * Clears the signed URL cache
 */
export function clearSignedUrlCache(): void {
  signedUrlCache.clear();
}
