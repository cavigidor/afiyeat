import { Button } from '@/components/ui/button';
import { LocateFixed } from 'lucide-react';

interface NearMeButtonProps {
  onClick: () => void;
  className?: string;
}

// Same floating "Near Me" button used on Explore's restaurant and events
// maps, pulled out so every other map (Friends, My Restaurants, Custom
// List Detail) can offer the same recenter-on-demand affordance instead of
// only auto-centering once when the map first loads.
export function NearMeButton({ onClick, className }: NearMeButtonProps) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className={className ?? 'absolute bottom-4 left-4 shadow-md gap-1.5 z-10'}
      onClick={onClick}
    >
      <LocateFixed className="h-4 w-4" />
      Near Me
    </Button>
  );
}
