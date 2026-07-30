export const PRICE_LABELS = ['<$30', '<$50', '<$100', '$100+'];

interface PriceLevelSelectorProps {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
}

/**
 * Four inline clickable price boxes. Clicking the active box clears it.
 */
export function PriceLevelSelector({ value, onChange }: PriceLevelSelectorProps) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {PRICE_LABELS.map((label, i) => {
        const level = i + 1;
        const active = value === level;
        return (
          <button
            key={label}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? null : level)}
            className={`rounded-lg border px-2 py-2 text-center transition-colors ${
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-muted/40 text-foreground hover:bg-muted'
            }`}
          >
            <span className="block text-sm font-semibold">{'$'.repeat(level)}</span>
            <span className="block text-[11px] opacity-80">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
