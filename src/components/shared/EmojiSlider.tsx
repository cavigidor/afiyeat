const FOOD_EMOJIS = ['🍕', '🍔', '🍣', '🌮', '🍜', '🥗', '🍰', '🍝', '🥘', '🍱'];

export const PRICE_LABELS = ['<$30', '<$50', '<$100', '$100+'];

export function EmojiSlider({
  value,
  onChange,
  min,
  max,
  emojiIndex,
  labels,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  emojiIndex: number;
  labels?: string[];
}) {
  const percentage = ((value - min) / (max - min)) * 100;
  const emoji = FOOD_EMOJIS[emojiIndex % FOOD_EMOJIS.length];
  const count = max - min + 1;

  return (
    <div className="relative pt-2 pb-6">
      <div className="relative h-8 bg-muted rounded-full overflow-hidden">
        <div
          className="absolute left-0 h-full bg-primary/30 rounded-l-full transition-all duration-150"
          style={{ width: `${percentage}%` }}
        />
        <div className="absolute inset-0 flex items-center justify-between px-2">
          {Array.from({ length: count }, (_, i) => (
            <span
              key={i}
              className={`text-xs font-medium transition-colors z-10 ${
                i + min <= value ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              {labels ? labels[i] : i + min}
            </span>
          ))}
        </div>
      </div>

      <div
        className="absolute top-0 -translate-x-1/2 cursor-grab active:cursor-grabbing select-none text-2xl transition-all duration-150"
        style={{ left: `${percentage}%` }}
      >
        {emoji}
      </div>

      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 w-full h-8 opacity-0 cursor-pointer"
      />
    </div>
  );
}
