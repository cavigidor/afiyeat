/**
 * Shown under a photo label once the limit is reached, so it's clear why
 * the add-photo tile has gone and what to do about it.
 */
export function PhotoCapNote({ count, max }: { count: number; max: number }) {
  if (count < max) return null;
  return (
    <p className="text-xs text-muted-foreground" role="status">
      You can only add {max} images. Remove one to add another.
    </p>
  );
}
