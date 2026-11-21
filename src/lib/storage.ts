import { supabase } from '@/integrations/supabase/client';

// Cache for signed URLs to reduce API calls
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const CACHE_BUFFER_MS = 5 * 60 * 1000; // 5 minutes buffer before expiry

// Every private image bucket in the app - both need signing since both
// were created (or later switched to, in restaurant-images's case) private.
export const IMAGE_BUCKETS = ['restaurant-images', 'custom-list-images'] as const;
export type ImageBucket = (typeof IMAGE_BUCKETS)[number];

export interface StorageRef {
  bucket: ImageBucket;
  path: string;
}

function isImageBucket(value: string): value is ImageBucket {
  return (IMAGE_BUCKETS as readonly string[]).includes(value);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Works out which private-bucket object a stored image value points at.
 *
 * The app has written three shapes into `image_url` columns over time, and
 * all of them must keep loading:
 *   1. A public-URL-shaped link, `<supabase>/storage/v1/object/public/<bucket>/<path>`
 *      (Add place, custom-list items, recipes). The buckets are private, so
 *      this URL is never loaded directly - it's just where the path lives.
 *   2. A bare object path, `<user>/<restaurant>/<file>` (the Edit place photo
 *      uploader, April-November 2026). Bare paths have no bucket in them, so
 *      `defaultBucket` says which one the caller's table stores into.
 *   3. A signed or authenticated object URL. A signed URL's token expires, so
 *      it is re-signed from its path rather than trusted as-is.
 *
 * Returns null for anything else (an external https image, a data: or blob:
 * preview), which callers use unchanged.
 */
export function parseStorageRef(
  value: string | null | undefined,
  defaultBucket: ImageBucket = 'restaurant-images',
): StorageRef | null {
  const raw = value?.trim();
  if (!raw) return null;

  const objectUrl = raw.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/);
  if (objectUrl) {
    const bucket = safeDecode(objectUrl[1]);
    return isImageBucket(bucket) ? { bucket, path: safeDecode(objectUrl[2]) } : null;
  }

  // Any other URL (has a scheme, or is protocol-/root-relative) isn't ours.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('/')) return null;

  // Bare object path, optionally prefixed with its bucket name.
  const slash = raw.indexOf('/');
  const head = slash > 0 ? raw.slice(0, slash) : '';
  if (isImageBucket(head)) return { bucket: head, path: raw.slice(slash + 1) };
  return { bucket: defaultBucket, path: raw };
}

/**
 * Extracts the bucket + storage path from a stored image value.
 * Kept for existing callers; see parseStorageRef for the accepted shapes.
 */
export function extractStoragePath(url: string): StorageRef | null {
  return parseStorageRef(url);
}

/**
 * The one format new uploads store in `image_url`: the public-URL shape every
 * other writer (and the existing rows) already use. It identifies the object
 * only - display always goes through a signed URL, because the buckets are
 * private.
 */
export function toStoredImageUrl(bucket: ImageBucket, path: string): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

/**
 * Why an image couldn't be signed. The storage API answers "Object not found"
 * both for an object that doesn't exist and for one the viewer's storage
 * policies hide, so 'missing' can also mean "not allowed"; the read-only SQL
 * in docs/LISTING_PHOTOS.md tells the two apart for an affected listing.
 */
export type SignFailure = 'missing' | 'forbidden' | 'error';
export type SignResult = { url: string; failure?: undefined } | { url: null; failure: SignFailure };

function classifySignError(err: unknown): SignFailure {
  const e = (err ?? {}) as { status?: number | string; statusCode?: number | string; message?: string };
  const status = Number(e.status ?? e.statusCode);
  const message = (e.message ?? '').toLowerCase();
  if (status === 404 || message.includes('not found')) return 'missing';
  if (status === 401 || status === 403 || message.includes('unauthorized') || message.includes('security')) {
    return 'forbidden';
  }
  return 'error';
}

function cacheKey(ref: StorageRef) {
  return `${ref.bucket}/${ref.path}`;
}

/** Signs one private-bucket object, with caching, reporting why it failed. */
export async function signImageRef(ref: StorageRef, expiresIn: number = 3600): Promise<SignResult> {
  const key = cacheKey(ref);
  const cached = signedUrlCache.get(key);
  if (cached && cached.expiresAt > Date.now() + CACHE_BUFFER_MS) {
    return { url: cached.url };
  }

  try {
    const { data, error } = await supabase.storage.from(ref.bucket).createSignedUrl(ref.path, expiresIn);
    if (error || !data?.signedUrl) {
      const failure = classifySignError(error);
      console.warn(`Couldn't sign ${key} (${failure}):`, error);
      return { url: null, failure };
    }

    signedUrlCache.set(key, { url: data.signedUrl, expiresAt: Date.now() + expiresIn * 1000 });
    return { url: data.signedUrl };
  } catch (error) {
    console.error('Error getting signed URL:', error);
    return { url: null, failure: 'error' };
  }
}

/**
 * Gets a signed URL for a storage path, with caching.
 * @returns The signed URL or null on error
 */
export async function getSignedImageUrl(
  bucket: ImageBucket,
  path: string,
  expiresIn: number = 3600,
): Promise<string | null> {
  if (!path) return null;
  return (await signImageRef({ bucket, path }, expiresIn)).url;
}

/**
 * Turns any stored image value into something an <img> can load: a signed URL
 * for our private buckets, or the value unchanged when it isn't ours.
 */
export async function resolveImageUrl(
  urlOrPath: string | null | undefined,
  defaultBucket?: ImageBucket,
): Promise<SignResult> {
  if (!urlOrPath) return { url: null, failure: 'missing' };
  const ref = parseStorageRef(urlOrPath, defaultBucket);
  if (!ref) return { url: urlOrPath };
  return signImageRef(ref);
}

/** resolveImageUrl, returning just the URL (null on failure). */
export async function getSignedUrl(
  urlOrPath: string | null | undefined,
  defaultBucket?: ImageBucket,
): Promise<string | null> {
  if (!urlOrPath) return null;
  return (await resolveImageUrl(urlOrPath, defaultBucket)).url;
}

/**
 * Synchronous, cache-only lookup for a signed URL - returns null on a cache
 * miss rather than fetching. Lets callers (see useSignedImageUrl) seed their
 * initial render state from an already-cached value, so a component that
 * remounts with an image it already showed a moment ago (e.g. switching
 * tabs, going back) paints the real image on the very first render instead
 * of flashing a loading spinner while the (redundant, cache-hit) async
 * lookup resolves.
 */
export function peekSignedUrl(urlOrPath: string | null | undefined, defaultBucket?: ImageBucket): string | null {
  if (!urlOrPath) return null;
  const ref = parseStorageRef(urlOrPath, defaultBucket);
  if (!ref) return urlOrPath; // Not one of our private buckets - usable as-is.

  const cached = signedUrlCache.get(cacheKey(ref));
  if (cached && cached.expiresAt > Date.now() + CACHE_BUFFER_MS) {
    return cached.url;
  }
  return null;
}

/**
 * Drops one image's cached signed URL, so the next lookup signs it afresh -
 * used when an <img> fails to load (an expired or revoked signature) and when
 * the person taps Retry.
 */
export function forgetSignedUrl(urlOrPath: string | null | undefined, defaultBucket?: ImageBucket): void {
  const ref = parseStorageRef(urlOrPath, defaultBucket);
  if (ref) signedUrlCache.delete(cacheKey(ref));
}

/**
 * Clears the signed URL cache
 */
export function clearSignedUrlCache(): void {
  signedUrlCache.clear();
}
