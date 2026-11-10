import { useEffect, useRef, useState } from 'react';
import { ImageOff, RotateCw } from 'lucide-react';
import { useSignedImageUrl } from '@/hooks/useSignedImageUrl';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import type { ImageBucket } from '@/lib/storage';

interface StorageImageProps {
  /** The stored image_url value (any shape parseStorageRef accepts). */
  value: string | null | undefined;
  /** Bucket a bare storage path lives in. */
  bucket?: ImageBucket;
  alt: string;
  /** Classes for the wrapper, which fills its parent by default. */
  className?: string;
  /** Classes for the <img>. */
  imgClassName?: string;
  /** Smaller spinner/fallback for thumbnails. */
  compact?: boolean;
}

/**
 * A photo from one of the app's private storage buckets, with its whole
 * lifecycle handled in one place:
 *  - a spinner until the image has actually loaded (not just been signed);
 *  - one automatic re-sign if the browser can't load it (an expired or
 *    revoked signature), since that's the common, self-healing case;
 *  - otherwise a clean "Photo unavailable" fallback with a Retry button,
 *    instead of the browser's broken-image icon.
 */
export function StorageImage({ value, bucket, alt, className, imgClassName, compact }: StorageImageProps) {
  const { signedUrl, loading, failure, retry } = useSignedImageUrl(value, bucket);
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const autoRetried = useRef(false);

  // A different photo, or a freshly signed URL for this one, starts over.
  useEffect(() => {
    setLoaded(false);
    setBroken(false);
  }, [signedUrl]);
  useEffect(() => {
    autoRetried.current = false;
  }, [value]);

  const handleError = () => {
    if (!autoRetried.current) {
      autoRetried.current = true;
      retry();
      return;
    }
    console.warn('Photo failed to load after re-signing:', value);
    setBroken(true);
  };

  const handleRetry = () => {
    autoRetried.current = false;
    setBroken(false);
    retry();
  };

  const showFallback = !loading && (!signedUrl || !!failure || broken);
  const iconSize = compact ? 'h-4 w-4' : 'h-8 w-8';

  return (
    <div className={cn('relative w-full h-full bg-muted overflow-hidden', className)}>
      {showFallback ? (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground"
          data-testid="photo-fallback"
        >
          <ImageOff className={iconSize} aria-hidden />
          {!compact && <span className="text-sm">Photo unavailable</span>}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRetry();
            }}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border border-border bg-background/90 font-medium text-foreground',
              compact ? 'p-1' : 'px-3 py-1 text-sm',
            )}
            aria-label="Retry loading photo"
          >
            <RotateCw className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden />
            {!compact && 'Retry'}
          </button>
        </div>
      ) : (
        <>
          {signedUrl && (
            <img
              key={signedUrl}
              src={signedUrl}
              alt={alt}
              onLoad={() => setLoaded(true)}
              onError={handleError}
              className={cn(
                'w-full h-full object-cover transition-opacity duration-200',
                loaded ? 'opacity-100' : 'opacity-0',
                imgClassName,
              )}
            />
          )}
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center" data-testid="photo-loading">
              <Spinner className={cn(iconSize, 'animate-spin text-muted-foreground/40')} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
