import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Loader2, ZoomIn } from 'lucide-react';

interface AvatarCropperProps {
  file: File | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCropComplete: (croppedBlob: Blob) => void;
  saving?: boolean;
}

export function AvatarCropper({ file, open, onOpenChange, onCropComplete, saving }: AvatarCropperProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);

  const CANVAS_SIZE = 280;

  // Load image when file changes
  useEffect(() => {
    if (!file) return;
    setImageLoaded(false);
    setZoom(1);
    setOffset({ x: 0, y: 0 });

    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);
    };
    img.src = URL.createObjectURL(file);

    return () => URL.revokeObjectURL(img.src);
  }, [file]);

  // Draw on canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Calculate scaled dimensions to fit image, then apply zoom
    const scale = Math.max(CANVAS_SIZE / img.width, CANVAS_SIZE / img.height) * zoom;
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (CANVAS_SIZE - w) / 2 + offset.x;
    const y = (CANVAS_SIZE - h) / 2 + offset.y;

    // Clip to circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();

    // Draw circle border
    ctx.beginPath();
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE / 2 - 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'hsl(var(--border))';
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [zoom, offset]);

  useEffect(() => {
    if (imageLoaded) draw();
  }, [imageLoaded, draw]);

  const getEventPos = (e: React.MouseEvent | React.TouchEvent) => {
    if ('touches' in e) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const pos = getEventPos(e);
    setDragging(true);
    setDragStart({ x: pos.x - offset.x, y: pos.y - offset.y });
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragging) return;
    e.preventDefault();
    const pos = getEventPos(e);
    setOffset({ x: pos.x - dragStart.x, y: pos.y - dragStart.y });
  };

  const handlePointerUp = () => setDragging(false);

  const handleCrop = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Create a new canvas at desired output size (512x512)
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = 512;
    outputCanvas.height = 512;
    const ctx = outputCanvas.getContext('2d');
    if (!ctx) return;

    // Draw the cropped circle onto the output
    const img = imageRef.current!;
    const scale = Math.max(CANVAS_SIZE / img.width, CANVAS_SIZE / img.height) * zoom;
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (CANVAS_SIZE - w) / 2 + offset.x;
    const y = (CANVAS_SIZE - h) / 2 + offset.y;

    // Scale factor from canvas to output
    const sf = 512 / CANVAS_SIZE;

    ctx.beginPath();
    ctx.arc(256, 256, 256, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, x * sf, y * sf, w * sf, h * sf);

    outputCanvas.toBlob(
      (blob) => {
        if (blob) onCropComplete(blob);
      },
      'image/jpeg',
      0.9
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Crop Profile Picture</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <div
            className="relative cursor-grab active:cursor-grabbing touch-none"
            style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
          >
            <canvas
              ref={canvasRef}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              className="rounded-full bg-muted"
              onMouseDown={handlePointerDown}
              onMouseMove={handlePointerMove}
              onMouseUp={handlePointerUp}
              onMouseLeave={handlePointerUp}
              onTouchStart={handlePointerDown}
              onTouchMove={handlePointerMove}
              onTouchEnd={handlePointerUp}
            />
          </div>

          <div className="flex items-center gap-3 w-full max-w-xs">
            <ZoomIn className="h-4 w-4 text-muted-foreground shrink-0" />
            <Slider
              value={[zoom]}
              onValueChange={([v]) => setZoom(v)}
              min={1}
              max={3}
              step={0.05}
              className="flex-1"
            />
          </div>

          <p className="text-xs text-muted-foreground">Drag to reposition, zoom to adjust</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleCrop} disabled={saving || !imageLoaded}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
