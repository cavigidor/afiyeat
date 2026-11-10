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
 *  3. read back from the insert, so the caller can show it immediately.
 * If the record can't be written, the object that was uploaded a moment ago
 * (and nothing else) is removed again so it doesn't become an orphan.
 * Failures are counted, never thrown: the item is already saved, and a retry
 * of the whole save would duplicate it.
 */

export interface AttachedPhoto {
  id: string;
  image_url: string;
}

export interface PhotoUploadResult {
  uploaded: number;
  failed: number;
  /** Rows written, in upload order (absent when nothing was attempted). */
  added?: AttachedPhoto[];
  /** The first failure, for logging and a precise message. */
  firstError?: unknown;
}

export function photoUploadWarning(result: PhotoUploadResult): string | null {
  if (!result.failed) return null;
  return `Your item was saved, but ${result.failed} ${result.failed === 1 ? 'photo' : 'photos'} couldn't be attached. Open the item to add ${result.failed === 1 ? 'it' : 'them'} again.`;
}

/** Message for adding photos to an item from its edit screen. */
export function photoUploadSummary(result: PhotoUploadResult): { kind: 'success' | 'partial' | 'error'; message: string } {
  const plural = (n: number) => `${n} photo${n === 1 ? '' : 's'}`;
  if (!result.failed) return { kind: 'success', message: `${plural(result.uploaded)} added` };
  const reason = describeUploadError(result.firstError);
  if (!result.uploaded) {
    return { kind: 'error', message: `Couldn't add ${result.failed === 1 ? 'the photo' : plural(result.failed)}. ${reason}` };
  }
  return { kind: 'partial', message: `${plural(result.uploaded)} added, ${result.failed} couldn't be uploaded. ${reason}` };
}

function describeUploadError(error: unknown): string {
  const e = (error ?? {}) as { message?: string; status?: number | string; statusCode?: number | string };
  const message = (e.message ?? '').toLowerCase();
  const status = Number(e.status ?? e.statusCode);
  if (status === 413 || message.includes('exceeded') || message.includes('too large')) return 'The photo is too large.';
  if (message.includes('mime') || message.includes('invalid_mime') || message.includes('not supported')) {
    return 'That file type isn’t supported.';
  }
  if (message.includes('failed to fetch') || message.includes('network')) return 'Check your connection and try again.';
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

type InsertResult = PromiseLike<{ data: AttachedPhoto | null; error: unknown }>;

interface AttachTarget {
  bucket: ImageBucket;
  /** Writes the attachment row for an uploaded object and reads it back. */
  record: (storedUrl: string) => InsertResult;
}

async function attachPhotos(
  target: AttachTarget,
  userId: string,
  ownerId: string,
  files: File[],
): Promise<PhotoUploadResult> {
  const result: PhotoUploadResult = { uploaded: 0, failed: 0, added: [] };
  for (const file of files) {
    const path = `${userId}/${ownerId}/${crypto.randomUUID()}.${photoExtension(file)}`;
    try {
      const { error: uploadError } = await supabase.storage
        .from(target.bucket)
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (uploadError) throw uploadError;

      const { data, error: insertError } = await target.record(toStoredImageUrl(target.bucket, path));
      if (insertError || !data) {
        // Only the object uploaded a moment ago, which nothing references.
        await supabase.storage.from(target.bucket).remove([path]).catch(() => undefined);
        throw insertError ?? new Error('Photo record was not saved');
      }

      result.uploaded++;
      result.added!.push(data);
    } catch (error) {
      console.error('Photo attachment failed:', error);
      result.failed++;
      if (result.firstError === undefined) result.firstError = error;
    }
  }
  return result;
}

export function uploadRestaurantPhotos(userId: string, restaurantId: string, files: File[]): Promise<PhotoUploadResult> {
  return attachPhotos(
    {
      bucket: 'restaurant-images',
      record: (image_url) =>
        supabase
          .from('restaurant_images')
          .insert({ restaurant_id: restaurantId, user_id: userId, image_url })
          .select('id, image_url')
          .single(),
    },
    userId,
    restaurantId,
    files,
  );
}

/** Attach photos without losing the already-saved custom-list item. */
export function uploadCustomListPhotos(userId: string, itemId: string, files: File[]): Promise<PhotoUploadResult> {
  return attachPhotos(
    {
      bucket: 'custom-list-images',
      record: (image_url) =>
        supabase
          .from('custom_list_item_images')
          .insert({ item_id: itemId, user_id: userId, image_url })
          .select('id, image_url')
          .single(),
    },
    userId,
    itemId,
    files,
  );
}
