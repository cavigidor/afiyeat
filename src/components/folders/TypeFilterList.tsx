import { Folder } from 'lucide-react';

interface TypeFilterOption {
  value: string;
  label: string;
  color: string;
  count: number;
}

interface TypeFilterListProps {
  options: TypeFilterOption[];
  selectedValue: string | null;
  onSelectValue: (value: string | null) => void;
}

export function TypeFilterList({
  options,
  selectedValue,
  onSelectValue,
}: TypeFilterListProps) {
  return (
    <div className="space-y-3">
      <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
        Types
      </h3>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => onSelectValue(null)}
          className={`w-full flex items-center gap-3 rounded-full px-4 py-3 text-left transition-colors ${
            selectedValue === null
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-muted/40 text-foreground hover:bg-muted'
          }`}
        >
          <Folder className="h-5 w-5 flex-shrink-0" />
          <span className="font-medium">All Restaurants</span>
        </button>

        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onSelectValue(option.value)}
            className={`w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
              selectedValue === option.value
                ? 'bg-muted text-foreground'
                : 'text-foreground hover:bg-muted/70'
            }`}
          >
            <span
              className="h-4 w-4 flex-shrink-0 rounded-full border border-border/50"
              style={{ backgroundColor: option.color }}
            />
            <span className="min-w-0 flex-1 truncate font-medium">{option.label}</span>
            <span className="text-sm text-muted-foreground">({option.count})</span>
          </button>
        ))}
      </div>
    </div>
  );
}