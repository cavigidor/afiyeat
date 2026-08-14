import { Star } from 'lucide-react';

interface StarRatingPickerProps {
  value: number | null | undefined;
  onChange: (value: number) => void;
  max?: number;
}

// Inline clickable stars (1-5 by default), filled cumulatively up to the
// clicked star - same "fill up to N" convention as PriceLevelPicker.
export function StarRatingPicker({ value, onChange, max = 5 }: StarRatingPickerProps) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: max }).map((_, i) => {
        const starValue = i + 1;
        const filled = value != null && starValue <= value;
        return (
          <button
            key={starValue}
            type="button"
            onClick={() => onChange(starValue)}
            aria-label={`${starValue} star${starValue === 1 ? '' : 's'}`}
            aria-pressed={value === starValue}
            className="p-0.5"
          >
            <Star
              className={`h-7 w-7 transition-colors ${
                filled ? 'text-yellow-500 fill-yellow-500' : 'text-muted-foreground/40'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
