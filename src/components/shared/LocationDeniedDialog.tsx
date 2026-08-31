import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MapPin } from 'lucide-react';
import { isNative } from '@/lib/native';
import { openAppSettings } from '@/lib/openAppSettings';

interface LocationDeniedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Shown when the user taps something location-based (Near Me, opening a
// map, adding a place) after having already denied location access -
// rather than silently failing or showing a generic error toast every
// time, this explains why it matters and offers a direct path to fix it.
export function LocationDeniedDialog({ open, onOpenChange }: LocationDeniedDialogProps) {
  const native = isNative();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Turn on location for the best experience
          </AlertDialogTitle>
          <AlertDialogDescription>
            {native
              ? "Afiyeat uses your location to center maps on you and show what's nearby. It looks like location access is off - you can turn it back on in Settings > Afiyeat > Location."
              : "Afiyeat uses your location to center maps on you and show what's nearby. It looks like your browser has location access blocked for this site - check your browser's site settings to turn it back on."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not Now</AlertDialogCancel>
          {native && (
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                openAppSettings();
                onOpenChange(false);
              }}
            >
              Open Settings
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
