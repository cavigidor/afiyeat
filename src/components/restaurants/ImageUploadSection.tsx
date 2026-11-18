import { useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { MAX_IMAGES_PER_RESTAURANT } from '@/lib/imageValidation';
import { usePhotoPicker } from '@/hooks/usePhotoPicker';
import { uploadRestaurantPhotos, photoUploadSummary } from '@/lib/photoUpload';
import { StorageImage } from '@/components/shared/StorageImage';
import { Spinner } from '@/components/ui/spinner';

interface ExistingImage {
  id: string;
  image_url: string;
}

const restaurantImagesKey = (restaurantId: string) => ['restaurant-images', restaurantId] as const;

async function fetchRestaurantImages(restaurantId: string): Promise<ExistingImage[]> {
  const { data, error } = await supabase
    .from('restaurant_images')
    .select('id, image_url')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

function ImageThumbnail({ image, onDelete }: { image: ExistingImage; onDelete: (id: string) => void }) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    onDelete(image.id);
  };

  return (
    <div className="relative group aspect-square rounded-lg overflow-hidden bg-muted">
      <StorageImage value={image.image_url} bucket="restaurant-images" alt="" compact />
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        aria-label="Remove photo"
        className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 reveal-on-hover"
      >
        {deleting ? <Spinner className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
      </button>
    </div>
  );
}

interface ImageUploadSectionProps {
  restaurantId: string;
  /** The photos the place had when the dialog opened - shown until the live list loads. */
  existingImages: ExistingImage[];
  onImagesChange: () => void;
}

export function ImageUploadSection({ restaurantId, existingImages, onImagesChange }: ImageUploadSectionProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [pendingCount, setPendingCount] = useState(0);
  const uploading = pendingCount > 0;

  // The dialog's `existingImages` prop is a snapshot taken when it opened, so
  // photos added here would never show up in it. This section keeps its own
  // live list instead (seeded with the snapshot so nothing flickers).
  const { data: images = existingImages } = useQuery({
    queryKey: restaurantImagesKey(restaurantId),
    queryFn: () => fetchRestaurantImages(restaurantId),
    placeholderData: existingImages,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: restaurantImagesKey(restaurantId) });
    onImagesChange();
  };

  const uploadPhotos = async (compressedFiles: File[]) => {
    if (!user || compressedFiles.length === 0) return;
    setPendingCount(compressedFiles.length);
    try {
      const result = await uploadRestaurantPhotos(user.id, restaurantId, compressedFiles);

      // Show what was saved straight away, from the rows the insert returned,
      // then let the refetch confirm it.
      if (result.added?.length) {
        queryClient.setQueryData<ExistingImage[]>(restaurantImagesKey(restaurantId), (prev) => [
          ...(prev ?? images),
          ...result.added!.filter((a) => !(prev ?? images).some((p) => p.id === a.id)),
        ]);
      }

      const summary = photoUploadSummary(result);
      if (summary.kind === 'success') toast.success(summary.message);
      else toast.error(summary.message);

      // Refetch for unconfirmed photos too: if their record did land, they show.
      if (result.uploaded > 0 || (result.unconfirmed ?? 0) > 0) refresh();
    } catch (err) {
      console.error('Photo upload failed:', err);
      toast.error("Couldn't upload that photo. Try again.");
    } finally {
      setPendingCount(0);
    }
  };

  // Cap, native capped picker, sequential compression - see usePhotoPicker.
  const photoPicker = usePhotoPicker({
    max: MAX_IMAGES_PER_RESTAURANT,
    count: images.length + pendingCount,
    onReady: uploadPhotos,
    busy: uploading,
  });

  const handleDeleteImage = async (imageId: string) => {
    const { error } = await supabase
      .from('restaurant_images')
      .delete()
      .eq('id', imageId);

    if (error) {
      toast.error('Failed to delete image');
    } else {
      queryClient.setQueryData<ExistingImage[]>(restaurantImagesKey(restaurantId), (prev) =>
        (prev ?? images).filter((img) => img.id !== imageId),
      );
      toast.success('Image deleted');
      refresh();
    }
  };

  const shown = images.length + pendingCount;

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium">
        Photos ({images.length}/{MAX_IMAGES_PER_RESTAURANT})
      </label>
      <div className="grid grid-cols-4 gap-2">
        {images.map((img) => (
          <ImageThumbnail key={img.id} image={img} onDelete={handleDeleteImage} />
        ))}
        {Array.from({ length: pendingCount }, (_, i) => (
          <div
            key={`pending-${i}`}
            className="aspect-square rounded-lg bg-muted flex items-center justify-center"
            data-testid="photo-uploading"
          >
            <Spinner className="h-4 w-4 animate-spin text-muted-foreground" label="Uploading photo" />
          </div>
        ))}
        {shown < MAX_IMAGES_PER_RESTAURANT && (
          <button
            type="button"
            onClick={() => void photoPicker.openPicker()}
            disabled={uploading || photoPicker.preparing}
            aria-label="Add photos"
            className="aspect-square rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center hover:border-primary/50 transition-colors"
          >
            {uploading || photoPicker.preparing ? (
              <Spinner className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <ImagePlus className="h-5 w-5 text-muted-foreground" />
            )}
          </button>
        )}
      </div>
      <input
        ref={photoPicker.inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        onChange={photoPicker.onInputChange}
        className="hidden"
        data-testid="photo-input"
      />
    </div>
  );
}
