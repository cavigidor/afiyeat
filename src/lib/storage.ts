import { supabase } from '@/integrations/supabase/client';

// Cache for signed URLs to reduce API calls
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const CACHE_BUFFER_MS = 5 * 60 * 1000; // 5 minutes buffer before expiry

/**
 * Extracts the storage path from a full public URL
 * @param url - The full URL (public or signed)
 * @returns The storage path or null if not a valid storage URL
 */
export function extractStoragePath(url: string): string | null {
  if (!url) return null;
  
  // Handle already-signed URLs (they contain /object/sign/)
  if (url.includes('/object/sign/')) {
    return null; // Already a signed URL, can't extract path
  }
  
  // Handle public URLs like: https://xxx.supabase.co/storage/v1/object/public/restaurant-images/path
  const publicMatch = url.match(/\/storage\/v1\/object\/public\/restaurant-images\/(.+?)(\?|$)/);
  if (publicMatch) {
    return publicMatch[1];
  }
  
  // Handle direct paths (already just the path)
  if (!url.startsWith('http')) {
    return url;
  }
  
  return null;
}

/**
 * Gets a signed URL for a storage path, with caching
 * @param path - The storage path within the restaurant-images bucket
 * @param expiresIn - Expiry time in seconds (default 1 hour)
 * @returns The signed URL or null on error
 */
export async function getSignedImageUrl(
  path: string,
  expiresIn: number = 3600
): Promise<string | null> {
  if (!path) return null;
  
  // Check cache first
  const cached = signedUrlCache.get(path);
  if (cached && cached.expiresAt > Date.now() + CACHE_BUFFER_MS) {
    return cached.url;
  }
  
  try {
    const { data, error } = await supabase.storage
      .from('restaurant-images')
      .createSignedUrl(path, expiresIn);
    
    if (error) {
      console.error('Error creating signed URL:', error);
      return null;
    }
    
    // Cache the result
    signedUrlCache.set(path, {
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
 * Converts a public URL or storage path to a signed URL
 * @param urlOrPath - The public URL or storage path
 * @returns The signed URL or null on error
 */
export async function getSignedUrl(urlOrPath: string | null | undefined): Promise<string | null> {
  if (!urlOrPath) return null;
  
  // If it's already a signed URL, return it (but it might be expired)
  if (urlOrPath.includes('/object/sign/')) {
    return urlOrPath;
  }
  
  // Extract the path from a public URL
  const path = extractStoragePath(urlOrPath);
  if (!path) {
    // Not a storage URL, return original
    return urlOrPath;
  }
  
  return getSignedImageUrl(path);
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
