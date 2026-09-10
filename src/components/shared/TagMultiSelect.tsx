import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, Plus } from 'lucide-react';

export interface TagOption {
  id: string;
  name: string;
  color?: string;
  icon?: string | null;
}

interface TagMultiSelectProps {
  options: TagOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  emptyHint?: string;
  onCreateNew?: () => void;
  createLabel?: string;
}

// Toggle-chip multi-select for "type" tags - lets a place/item be tagged
// with any number of types (Bar + Cafe, etc.) instead of just one, by
// clicking chips on/off rather than picking a single option from a
// dropdown.
export function TagMultiSelect({
  options,
  value,
  onChange,
  emptyHint = 'No types yet',
  onCreateNew,
  createLabel = 'Create New Type',
}: TagMultiSelectProps) {
  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  if (options.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{emptyHint}</p>
        {onCreateNew && (
          <Button type="button" variant="outline" size="sm" onClick={onCreateNew}>
            <Plus className="h-4 w-4 mr-2" />
            {createLabel}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const selected = value.includes(option.id);
        return (
          <Badge
            key={option.id}
            variant={selected ? 'default' : 'outline'}
            className="cursor-pointer gap-1.5 select-none"
            style={selected && option.color ? { backgroundColor: option.color, borderColor: option.color } : undefined}
            onClick={() => toggle(option.id)}
          >
            {selected && <Check className="h-3 w-3" />}
            {option.icon ? (
              <span className="text-xs leading-none">{option.icon}</span>
            ) : option.color && !selected ? (
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: option.color }} />
            ) : null}
            {option.name}
          </Badge>
        );
      })}
      {onCreateNew && (
        <Badge variant="outline" className="cursor-pointer gap-1" onClick={onCreateNew}>
          <Plus className="h-3 w-3" />
          New
        </Badge>
      )}
    </div>
  );
}
