import { useState, useRef } from 'react';
import { ImagePlus, Loader2, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { validateImageFile } from '@/lib/imageValidation';
import { useSignedImageUrl } from '@/hooks/useSignedImageUrl';

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
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <img src={signedUrl || ''} alt="" className="w-full h-full object-cover" />
      )}
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
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

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !user) return;

    const fileArray = Array.from(files);
    for (const file of fileArray) {
      const error = validateImageFile(file);
      if (error) {
        toast.error(error);
        return;
      }
    }

    setUploading(true);
    try {
      for (const file of fileArray) {
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

      toast.success(`${fileArray.length} image${fileArray.length > 1 ? 's' : ''} uploaded!`);
      onImagesChange();
    } catch (err: any) {
      toast.error(err.message || 'Failed to upload image');
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
      <label className="text-sm font-medium">Photos</label>
      <div className="grid grid-cols-4 gap-2">
        {existingImages.map((img) => (
          <ImageThumbnail key={img.id} image={img} onDelete={handleDeleteImage} />
        ))}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="aspect-square rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center hover:border-primary/50 transition-colors"
        >
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <ImagePlus className="h-5 w-5 text-muted-foreground" />
          )}
        </button>
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
