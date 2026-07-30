interface PriceLevelPickerProps {
  value: number | null | undefined;
  onChange: (value: number) => void;
  labels?: string[];
}

/**
 * Four inline clickable boxes for price level (1-4 = $ to $$$$), filled
 * cumulatively up to the clicked box - same "fill up to N" convention used
 * for displaying price level elsewhere (RestaurantCard, RestaurantListRow,
 * PlaceDetailSheet, RestaurantDetailDialog). Replaces the drag-slider that
 * was previously shared with the 0-10 rating field.
 */
export function PriceLevelPicker({ value, onChange, labels }: PriceLevelPickerProps) {
  return (
    <div className="flex items-center gap-2">
      {[1, 2, 3, 4].map((level) => {
        const filled = value != null && level <= value;
        return (
          <button
            key={level}
            type="button"
            onClick={() => onChange(level)}
            aria-label={labels ? labels[level - 1] : '$'.repeat(level)}
            aria-pressed={value === level}
            className={`flex-1 h-11 rounded-lg border text-sm font-semibold tracking-wide transition-colors ${
              filled
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted'
            }`}
          >
            {'$'.repeat(level)}
          </button>
        );
      })}
    </div>
  );
}
