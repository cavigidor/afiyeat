import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { capturePhoto, isNative, pickGalleryPhotos } from '@/lib/native';
import { compressImages, photoLimitError, validateImageFile } from '@/lib/imageValidation';

interface UsePhotoPickerOptions {
  /** The cap, e.g. MAX_IMAGES_PER_RESTAURANT (5). */
  max: number;
  /** Photos already attached or on their way (counts toward the cap). */
  count: number;
  /** Receives the validated, compressed photos. */
  onReady: (files: File[]) => void | Promise<void>;
  /** Something else is in progress (e.g. an upload); ignore new picks. */
  busy?: boolean;
}

/**
 * Shared photo picking for every "add photos" tile, so they all behave the
 * same way:
 *
 *  - iPhone app: openPicker() opens Apple's photo picker capped at the photos
 *    still allowed, so it isn't possible to select too many (see
 *    pickGalleryPhotos). If that picker can't be used, it falls back to the
 *    file input.
 *  - Web, and as a backstop: picking more than the cap is rejected straight
 *    away with "You can only add 5 images", before anything is decoded or
 *    compressed. Nothing is silently dropped.
 *  - Photos are compressed one at a time (decoding several full-size photos
 *    at once can run the iOS WebView out of memory) and `preparing` is true
 *    meanwhile, for a spinner.
 *
 * Render a hidden <input type="file" multiple ref={inputRef}
 * onChange={onInputChange}> and point the tile's onClick at openPicker.
 */
export function usePhotoPicker({ max, count, onReady, busy = false }: UsePhotoPickerOptions) {
  const [preparing, setPreparing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const working = preparing || busy;

  const addFiles = async (incoming: File[]) => {
    if (incoming.length === 0 || working) return;

    const limitError = photoLimitError(incoming.length, count, max);
    if (limitError) {
      toast.error(limitError);
      return;
    }

    const valid = incoming.filter((file) => {
      const issue = validateImageFile(file);
      if (issue) toast.error(`${file.name}: ${issue}`);
      return !issue;
    });
    if (valid.length === 0) return;

    setPreparing(true);
    let compressed: File[];
    try {
      compressed = await compressImages(valid);
    } catch (err) {
      console.error('Photo preparation failed:', err);
      toast.error("Couldn't prepare that photo. Try a different one.");
      return;
    } finally {
      setPreparing(false);
    }
    await onReady(compressed);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    // Clear it so picking the same photos again still fires onChange.
    e.target.value = '';
    void addFiles(files);
  };

  const openPicker = async () => {
    if (working) return;
    if (!isNative()) {
      // Straight from the tap, so the browser lets the file picker open.
      inputRef.current?.click();
      return;
    }
    const remaining = max - count;
    if (remaining <= 0) {
      toast.error(photoLimitError(1, count, max) ?? `You can only add ${max} images.`);
      return;
    }
    const result = await pickGalleryPhotos(remaining);
    if (result.status === 'picked') void addFiles(result.files);
    else if (result.status === 'unavailable') inputRef.current?.click();
  };

  const takePhoto = async () => {
    if (working) return;
    const file = await capturePhoto();
    if (file) void addFiles([file]);
  };

  return { inputRef, preparing: working, addFiles, onInputChange, openPicker, takePhoto };
}
