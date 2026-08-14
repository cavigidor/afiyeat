import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Navigation } from 'lucide-react';
import {
  getAppleMapsUrl,
  getGoogleMapsUrl,
  hasDirectionsTarget,
  openDirections,
  type DirectionsTarget,
} from '@/lib/directions';

interface GetDirectionsButtonProps extends DirectionsTarget {
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'icon';
  className?: string;
  // Icon-only (no "Get Directions" label) - for tight spaces like a card or
  // popup where the full button would crowd other controls.
  iconOnly?: boolean;
}

export function GetDirectionsButton({
  variant = 'outline',
  size = 'sm',
  className,
  iconOnly = false,
  ...target
}: GetDirectionsButtonProps) {
  if (!hasDirectionsTarget(target)) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={iconOnly ? 'icon' : size}
          className={className}
          aria-label="Get directions"
          onClick={(e) => e.stopPropagation()}
        >
          <Navigation className={iconOnly ? 'h-4 w-4' : 'h-4 w-4 mr-1.5'} />
          {!iconOnly && 'Directions'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => openDirections(getAppleMapsUrl(target))}>
          Apple Maps
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openDirections(getGoogleMapsUrl(target))}>
          Google Maps
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
