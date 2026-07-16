import { Button } from '@/components/ui/button';
import { LayoutGrid, List as ListIcon } from 'lucide-react';
import type { ViewMode } from '@/hooks/useViewMode';

interface ListViewToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ListViewToggle({ value, onChange }: ListViewToggleProps) {
  return (
    <div className="inline-flex items-center rounded-md border p-0.5 bg-muted/40 shrink-0">
      <Button
        type="button"
        variant={value === 'grid' ? 'secondary' : 'ghost'}
        size="icon"
        className="h-8 w-8"
        aria-label="Grid view"
        aria-pressed={value === 'grid'}
        onClick={() => onChange('grid')}
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant={value === 'list' ? 'secondary' : 'ghost'}
        size="icon"
        className="h-8 w-8"
        aria-label="List view"
        aria-pressed={value === 'list'}
        onClick={() => onChange('list')}
      >
        <ListIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}
