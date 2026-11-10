import { supabase } from '@/integrations/supabase/client';
import { toStoredImageUrl, type ImageBucket } from '@/lib/storage';

/**
 * The one implementation of "attach photos to an item that already exists",
 * used by Add place, Edit place and the custom-list add/edit dialog.
 *
 * The exported names and the PhotoUploadResult shape match the photo helpers
 * in PR #7's lib/listItemSave.ts on purpose: when that PR is rebased, it
 * imports these instead of keeping its own copies.
 *
 * Every photo is:
 *  1. uploaded to the owner's folder in the private bucket;
 *  2. recorded in the attachment table in the ONE stored format
 *     (toStoredImageUrl) - never a bare path, which display code couldn't
 *     sign between August and this fix;
 *  3. read back, so the caller can show it immediately.
 *
 * Network answers are not always trustworthy: a request can time out, lose
 * its response, or succeed without returning the row. So each attachment row
 * gets its id from the client. That makes the insert idempotent - a retry
 * either writes the row or hits the primary key ("already saved") - and lets
 * the helper look the row up by id to settle an unclear outcome, reading only
 * the caller's own row.
 *
 * An uploaded object is removed again ONLY when the database definitively
 * rejected the one and only insert attempt (it answered with an error code,
 * so the statement rolled back). Whenever the outcome can't be confirmed the
 * object is kept, because a row may already point at it; it's reported as
 * `unconfirmed` and logged for follow-up (see docs/LISTING_PHOTOS.md, orphan
 * report).
 *
 * Failures are counted, never thrown: the item is already saved, and a retry
 * of the whole save would duplicate it.
 */

export interface AttachedPhoto {
  id: string;
  image_url: string;
}

export interface PhotoUploadResult {
  uploaded: number;
  /** Photos not attached - includes `unconfirmed`. */
  failed: number;
  /** Of `failed`: uploaded, but whether the record was saved couldn't be confirmed. */
  unconfirmed?: number;
  /** Rows written, in upload order (absent when nothing was attempted). */
  added?: AttachedPhoto[];
  /** The first failure, for logging and a precise message. */
  firstError?: unknown;
}

export interface AttachOptions {
  /** Milliseconds before an upload / insert / lookup is treated as an unclear outcome. */
  timeouts?: Partial<typeof DEFAULT_TIMEOUTS>;
}

const DEFAULT_TIMEOUTS = { upload: 60_000, insert: 15_000, lookup: 10_000 };

export function photoUploadWarning(result: PhotoUploadResult): string | null {
  if (!result.failed) return null;
  const unconfirmed = result.unconfirmed ?? 0;
  const notAttached = result.failed - unconfirmed;
  const n = (k: number) => `${k} ${k === 1 ? 'photo' : 'photos'}`;
  if (!notAttached) {
    return `Your item was saved, but we couldn't confirm ${n(unconfirmed)}. Refresh in a moment - ${unconfirmed === 1 ? 'it' : 'they'} may already be there.`;
  }
  const base = `Your item was saved, but ${n(notAttached)} couldn't be attached. Open the item to add ${notAttached === 1 ? 'it' : 'them'} again.`;
  return unconfirmed ? `${base} ${n(unconfirmed)} couldn't be confirmed yet - refresh to check.` : base;
}

/** Message for adding photos to an item from its edit screen. */
export function photoUploadSummary(result: PhotoUploadResult): { kind: 'success' | 'partial' | 'error'; message: string } {
  const plural = (n: number) => `${n} photo${n === 1 ? '' : 's'}`;
  if (!result.failed) return { kind: 'success', message: `${plural(result.uploaded)} added` };
  const unconfirmed = result.unconfirmed ?? 0;
  const notAdded = result.failed - unconfirmed;
  const reason = describeUploadError(result.firstError);
  const check = 'refresh in a moment to check.';

  let message = '';
  if (result.uploaded) {
    message = `${plural(result.uploaded)} added`;
    if (notAdded) message += `, ${notAdded} couldn't be uploaded. ${reason}`;
    if (unconfirmed) message += `${notAdded ? ' ' : ', '}${unconfirmed} couldn't be confirmed yet - ${check}`;
  } else {
    if (notAdded) message = `Couldn't add ${notAdded === 1 ? 'the photo' : plural(notAdded)}. ${reason}`;
    if (unconfirmed) {
      message += `${notAdded ? ' ' : ''}Couldn't confirm ${unconfirmed === 1 ? 'the photo was' : `${plural(unconfirmed)} were`} saved - ${check}`;
    }
  }
  return { kind: result.uploaded ? 'partial' : 'error', message };
}

function describeUploadError(error: unknown): string {
  const e = (error ?? {}) as { message?: string; status?: number | string; statusCode?: number | string };
  const message = (e.message ?? '').toLowerCase();
  const status = Number(e.status ?? e.statusCode);
  if (status === 413 || message.includes('exceeded') || message.includes('too large')) return 'The photo is too large.';
  if (message.includes('mime') || message.includes('not supported')) return 'That file type isn’t supported.';
  if (message.includes('failed to fetch') || message.includes('network') || message.includes('timed out')) {
    return 'Check your connection and try again.';
  }
  return 'Please try again.';
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** File extension from the MIME type (camera captures can have no usable name). */
export function photoExtension(file: File): string {
  const fromType = EXT_BY_TYPE[file.type];
  if (fromType) return fromType;
  const dot = file.name.lastIndexOf('.');
  return dot > 0 ? file.name.slice(dot + 1).toLowerCase() : 'jpg';
}

// ---------------------------------------------------------------------------
// Outcome classification
// ---------------------------------------------------------------------------

class TimeoutError extends Error {
  constructor(what: string) {
    super(`${what} timed out`);
    this.name = 'TimeoutError';
  }
}

/** Resolves with the promise, or rejects with TimeoutError. The request itself may still complete. */
function withTimeout<T>(promise: PromiseLike<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(what)), ms);
    Promise.resolve(promise).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

type ApiError = { code?: string; status?: number | string; statusCode?: number | string; message?: string } | null | undefined;

function httpStatus(err: ApiError, responseStatus?: number): number {
  const n = Number(responseStatus ?? err?.status ?? err?.statusCode);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Did the database answer "no, nothing was written"? Only an error the
 * server itself produced counts: an HTTP 4xx carrying a Postgres/PostgREST
 * error code. A lost connection (status 0, empty code), a timeout, a gateway
 * 5xx or 429, or a "no row came back" (PGRST116) don't prove anything.
 */
function isDefinitiveRejection(err: ApiError, responseStatus?: number): boolean {
  const status = httpStatus(err, responseStatus);
  const code = err?.code ?? '';
  return status >= 400 && status < 500 && status !== 408 && status !== 429 && !!code && code !== 'PGRST116' && code !== '23505';
}

type InsertOutcome =
  | { kind: 'saved'; row: AttachedPhoto }
  | { kind: 'rejected'; error: unknown }
  | { kind: 'exists' } // primary key already taken: an earlier attempt landed
  | { kind: 'unclear'; error: unknown };

type InsertFn = (row: AttachedPhoto) => PromiseLike<{ data: AttachedPhoto | null; error: ApiError; status?: number }>;
type LookupFn = (id: string) => PromiseLike<{ data: AttachedPhoto | null; error: ApiError }>;

async function tryInsert(insert: InsertFn, row: AttachedPhoto, ms: number): Promise<InsertOutcome> {
  try {
    const { data, error, status } = await withTimeout(insert(row), ms, 'Saving the photo record');
    if (!error && data?.id) return { kind: 'saved', row: data };
    if (!error) return { kind: 'unclear', error: new Error('Photo record was not returned') };
    if (error.code === '23505') return { kind: 'exists' };
    return isDefinitiveRejection(error, status) ? { kind: 'rejected', error } : { kind: 'unclear', error };
  } catch (error) {
    return { kind: 'unclear', error };
  }
}

/** found / absent (the lookup answered, no such row) / unknown (lookup failed). */
async function lookup(find: LookupFn, id: string, ms: number): Promise<{ kind: 'found'; row: AttachedPhoto } | { kind: 'absent' | 'unknown' }> {
  try {
    const { data, error } = await withTimeout(find(id), ms, 'Checking the photo record');
    if (error) return { kind: 'unknown' };
    return data?.id ? { kind: 'found', row: data } : { kind: 'absent' };
  } catch {
    return { kind: 'unknown' };
  }
}

/**
 * Settles an insert whose first attempt didn't clearly succeed or fail:
 * look the row up by its id; if it isn't there, retry the (idempotent) insert
 * once; look up again if that is unclear too.
 */
async function settleInsert(insert: InsertFn, find: LookupFn, row: AttachedPhoto, t: typeof DEFAULT_TIMEOUTS) {
  const first = await lookup(find, row.id, t.lookup);
  if (first.kind === 'found') return first.row;

  const retry = await tryInsert(insert, row, t.insert);
  if (retry.kind === 'saved') return retry.row;

  const last = await lookup(find, row.id, t.lookup);
  if (last.kind === 'found') return last.row;
  // 'exists' with a failed lookup still means the row is there.
  if (retry.kind === 'exists') return row;
  return null;
}

// ---------------------------------------------------------------------------
// Upload + attach
// ---------------------------------------------------------------------------

interface AttachTarget {
  bucket: ImageBucket;
  insert: InsertFn;
  find: LookupFn;
}

type UploadOutcome = { kind: 'stored' } | { kind: 'failed'; error: unknown; maybeStored: boolean };

async function uploadObject(bucket: ImageBucket, path: string, file: File, ms: number): Promise<UploadOutcome> {
  const attempt = async () => {
    try {
      const { error } = await withTimeout(
        supabase.storage.from(bucket).upload(path, file, { contentType: file.type || undefined, upsert: false }),
        ms,
        'Uploading the photo',
      );
      if (!error) return { kind: 'stored' as const };
      const status = httpStatus(error as ApiError);
      if (status === 409) return { kind: 'duplicate' as const };
      const definite = status >= 400 && status < 500 && status !== 408 && status !== 429;
      return { kind: definite ? ('rejected' as const) : ('unclear' as const), error };
    } catch (error) {
      return { kind: 'unclear' as const, error };
    }
  };

  const first = await attempt();
  if (first.kind === 'stored') return first;
  if (first.kind === 'rejected') return { kind: 'failed', error: first.error, maybeStored: false };
  if (first.kind === 'duplicate') return { kind: 'stored' }; // fresh random path: only we could have put it there

  // Unclear: retry the same path. "Already exists" proves the first one landed.
  const second = await attempt();
  if (second.kind === 'stored' || second.kind === 'duplicate') return { kind: 'stored' };
  return { kind: 'failed', error: first.error, maybeStored: true };
}

async function attachPhotos(
  target: AttachTarget,
  userId: string,
  ownerId: string,
  files: File[],
  options?: AttachOptions,
): Promise<PhotoUploadResult> {
  const t = { ...DEFAULT_TIMEOUTS, ...options?.timeouts };
  const result: PhotoUploadResult = { uploaded: 0, failed: 0, unconfirmed: 0, added: [] };
  const fail = (error: unknown) => {
    result.failed++;
    if (result.firstError === undefined) result.firstError = error;
  };

  for (const file of files) {
    const path = `${userId}/${ownerId}/${crypto.randomUUID()}.${photoExtension(file)}`;
    const row: AttachedPhoto = { id: crypto.randomUUID(), image_url: toStoredImageUrl(target.bucket, path) };

    let uploaded = false;
    try {
      const upload = await uploadObject(target.bucket, path, file, t.upload);
      if (upload.kind === 'failed') {
        if (upload.maybeStored) console.warn('Photo upload outcome unclear; any stored object is kept:', path);
        console.error('Photo upload failed:', upload.error);
        fail(upload.error);
        continue;
      }
      uploaded = true;

      const first = await tryInsert(target.insert, row, t.insert);
      if (first.kind === 'saved') {
        result.uploaded++;
        result.added!.push(first.row);
        continue;
      }

      if (first.kind === 'rejected') {
        // The database refused the only attempt, so nothing references the
        // object uploaded a moment ago: safe to remove it.
        console.error('Photo record rejected:', first.error);
        await supabase.storage.from(target.bucket).remove([path]).catch(() => undefined);
        fail(first.error);
        continue;
      }

      const settled = await settleInsert(target.insert, target.find, row, t);
      if (settled) {
        result.uploaded++;
        result.added!.push(settled);
        continue;
      }

      // Can't tell whether a record points at the object: keep it.
      console.warn('Photo record outcome unconfirmed; object kept for follow-up:', path, row.id);
      result.unconfirmed!++;
      fail(first.kind === 'unclear' ? first.error : new Error('Photo record could not be confirmed'));
    } catch (error) {
      // Unexpected exception in our own code. Never remove anything here.
      console.error('Photo attachment failed:', error, uploaded ? `(object kept: ${path})` : '');
      if (uploaded) result.unconfirmed!++;
      fail(error);
    }
  }
  return result;
}

export function uploadRestaurantPhotos(
  userId: string,
  restaurantId: string,
  files: File[],
  options?: AttachOptions,
): Promise<PhotoUploadResult> {
  return attachPhotos(
    {
      bucket: 'restaurant-images',
      insert: (row) =>
        supabase
          .from('restaurant_images')
          .insert({ id: row.id, restaurant_id: restaurantId, user_id: userId, image_url: row.image_url })
          .select('id, image_url')
          .single(),
      find: (id) => supabase.from('restaurant_images').select('id, image_url').eq('id', id).maybeSingle(),
    },
    userId,
    restaurantId,
    files,
    options,
  );
}

/** Attach photos without losing the already-saved custom-list item. */
export function uploadCustomListPhotos(
  userId: string,
  itemId: string,
  files: File[],
  options?: AttachOptions,
): Promise<PhotoUploadResult> {
  return attachPhotos(
    {
      bucket: 'custom-list-images',
      insert: (row) =>
        supabase
          .from('custom_list_item_images')
          .insert({ id: row.id, item_id: itemId, user_id: userId, image_url: row.image_url })
          .select('id, image_url')
          .single(),
      find: (id) => supabase.from('custom_list_item_images').select('id, image_url').eq('id', id).maybeSingle(),
    },
    userId,
    itemId,
    files,
    options,
  );
}
