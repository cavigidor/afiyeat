import { useState, useRef } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { validateImageFile, compressImages, photoLimitError, MAX_IMAGES_PER_RESTAURANT } from '@/lib/imageValidation';
import { useSignedImageUrl } from '@/hooks/useSignedImageUrl';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage } from '@/lib/utils';
import { isNative, pickGalleryPhotos } from '@/lib/native';

interface ExistingImage {
  id: string;
  image_url: string;
}

function ImageThumbnail({ image, onDelete }: { image: ExistingImage; onDelete: (id: string) => void }) {
  const { signedUrl, loading } = useSignedImageUrl(image.image_url);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    onDelete(image.id);
  };

  return (
    <div className="relative group aspect-square rounded-lg overflow-hidden bg-muted">
      {loading ? (
        <div className="w-full h-full flex items-center justify-center">
          <Spinner className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <img src={signedUrl || ''} alt="" className="w-full h-full object-cover" />
      )}
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 reveal-on-hover"
      >
        {deleting ? <Spinner className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
      </button>
    </div>
  );
}

interface ImageUploadSectionProps {
  restaurantId: string;
  existingImages: ExistingImage[];
  onImagesChange: () => void;
}

export function ImageUploadSection({ restaurantId, existingImages, onImagesChange }: ImageUploadSectionProps) {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    uploadFiles(Array.from(e.target.files || []));
  };

  // On the iPhone app, open the native photo picker capped at the photos
  // still allowed, so it's impossible to select too many in the first place.
  // On the web (or if the native picker fails) use the file input instead.
  const handlePickPhotos = async () => {
    if (uploading) return;
    if (!isNative()) {
      fileInputRef.current?.click();
      return;
    }
    const result = await pickGalleryPhotos(MAX_IMAGES_PER_RESTAURANT - existingImages.length);
    if (result.status === 'picked') uploadFiles(result.files);
    else if (result.status === 'unavailable') fileInputRef.current?.click();
  };

  const uploadFiles = async (fileArray: File[]) => {
    if (!user || fileArray.length === 0) return;

    // Check the count first, before touching any of the files: picking too
    // many gets an immediate error instead of a long "buffering" pause.
    const limitError = photoLimitError(fileArray.length, existingImages.length, MAX_IMAGES_PER_RESTAURANT);
    if (limitError) {
      toast.error(limitError);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    for (const file of fileArray) {
      const error = validateImageFile(file);
      if (error) {
        toast.error(error);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
    }
    const toUpload = fileArray;

    setUploading(true);
    try {
      // Downscale/re-encode before upload - see compressImage() for why.
      const compressedFiles = await compressImages(toUpload);
      for (const file of compressedFiles) {
        const ext = file.name.split('.').pop();
        const path = `${user.id}/${restaurantId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('restaurant-images')
          .upload(path, file);

        if (uploadError) throw uploadError;

        const { error: dbError } = await supabase
          .from('restaurant_images')
          .insert({
            restaurant_id: restaurantId,
            user_id: user.id,
            image_url: path,
          });

        if (dbError) throw dbError;
      }

      toast.success(`${toUpload.length} image${toUpload.length > 1 ? 's' : ''} uploaded!`);
      onImagesChange();
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to upload image'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteImage = async (imageId: string) => {
    const { error } = await supabase
      .from('restaurant_images')
      .delete()
      .eq('id', imageId);

    if (error) {
      toast.error('Failed to delete image');
    } else {
      toast.success('Image deleted');
      onImagesChange();
    }
  };

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium">
        Photos ({existingImages.length}/{MAX_IMAGES_PER_RESTAURANT})
      </label>
      <div className="grid grid-cols-4 gap-2">
        {existingImages.map((img) => (
          <ImageThumbnail key={img.id} image={img} onDelete={handleDeleteImage} />
        ))}
        {existingImages.length < MAX_IMAGES_PER_RESTAURANT && (
          <button
            type="button"
            onClick={handlePickPhotos}
            disabled={uploading}
            className="aspect-square rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center hover:border-primary/50 transition-colors"
          >
            {uploading ? (
              <Spinner className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <ImagePlus className="h-5 w-5 text-muted-foreground" />
            )}
          </button>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        onChange={handleUpload}
        className="hidden"
      />
    </div>
  );
}
