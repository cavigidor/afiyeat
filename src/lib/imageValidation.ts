const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB - checked AFTER compression below,
// so this is really just a backstop against something pathological, not the
// limit a normal phone photo needs to squeeze under.
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export const MAX_IMAGES_PER_RESTAURANT = 5;
// Same cap, just named for the generic My Lists feature (custom list items)
// rather than restaurants specifically.
export const MAX_IMAGES_PER_ITEM = 5;

/**
 * Checks a new photo selection against the per-place/per-item cap BEFORE
 * anything is decoded or compressed. Returns an error message if the
 * selection would go over the cap, otherwise null.
 *
 * Picking more than the cap used to quietly keep the first few and start
 * compressing them, which on a phone looked like the app hanging. Now the
 * whole selection is rejected straight away with a clear message, and the
 * user can pick again.
 */
export function photoLimitError(selectedCount: number, alreadyAdded: number, max: number): string | null {
  const remaining = max - alreadyAdded;
  if (selectedCount <= remaining) return null;
  if (remaining <= 0) return `You can only add ${max} images. Remove one to add another.`;
  if (alreadyAdded === 0) return `You can only add ${max} images.`;
  return `You can only add ${max} images. You have room for ${remaining} more.`;
}

/**
 * compressImage() over a list, one at a time. Decoding several full-size
 * phone photos at once can exhaust the iOS WebView's memory, so this
 * deliberately doesn't use Promise.all.
 */
export async function compressImages(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const file of files) {
    out.push(await compressImage(file));
  }
  return out;
}

export function validateImageFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE) {
    return 'File size must be less than 8MB';
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return 'Only JPEG, PNG, GIF, and WebP images are allowed';
  }
  return null;
}

/**
 * Downscales + re-encodes a photo before it ever gets uploaded, so a normal
 * multi-megabyte phone camera photo (which is what was tripping the old 5MB
 * cap after 1-2 images) comes in well under any reasonable size limit,
 * while still looking fine in the app's thumbnails/detail views. GIFs are
 * passed through untouched to avoid losing animation. Falls back to the
 * original file if decoding/compression fails for any reason, or if the
 * "compressed" result would somehow be larger than the original.
 */
export async function compressImage(
  file: File,
  maxDimension = 1600,
  quality = 0.82,
): Promise<File> {
  if (file.type === 'image/gif') return file;

  try {
    const source = await decodeImage(file);
    if (!source) return file;

    const { width, height } = getDimensions(source);
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (!blob || blob.size >= file.size) return file;

    const newName = file.name.replace(/\.[^./]+$/, '') + '.jpg';
    return new File([blob], newName, { type: 'image/jpeg' });
  } catch (err) {
    console.error('Image compression failed, using original file:', err);
    return file;
  }
}

function getDimensions(source: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      // Some browsers/WebViews can fail to decode certain files via
      // createImageBitmap - fall through to the <img> based approach below.
    }
  }
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resolve(img);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}
