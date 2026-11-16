import type { LucideIcon } from 'lucide-react';
import { Utensils, Wine, Coffee, CupSoda, ShoppingBag, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

// Lists V2 presets are drawn as line icons on a tinted tile (as in the approved mockups). Every other
// list keeps showing the emoji stored in custom_lists.icon, exactly as before.
const LINE_ICONS: Record<string, { Icon: LucideIcon; fg: string; bg: string }> = {
  '🍽️': { Icon: Utensils, fg: '#C2412A', bg: '#FBE6E1' },
  '🍸': { Icon: Wine, fg: '#7B4FA0', bg: '#EEE6F4' },
  '🫘': { Icon: Coffee, fg: '#7A4E2D', bg: '#F1E6DC' },
  '☕': { Icon: CupSoda, fg: '#7A4E2D', bg: '#F1E6DC' },
  '🛍️': { Icon: ShoppingBag, fg: '#1F6F75', bg: '#E1EFF0' },
  '🌍': { Icon: Globe, fg: '#2A5C9A', bg: '#E3ECF8' },
};

export const MY_RESTAURANTS_GLYPH = '🍽️';

interface ListGlyphProps {
  icon: string | null | undefined;
  /** The list's own colour, used to tint emoji tiles. */
  color?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = { sm: 'h-9 w-9 rounded-lg text-base', md: 'h-11 w-11 rounded-xl text-xl', lg: 'h-14 w-14 rounded-2xl text-2xl' };
const ICON_SIZES = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-6 w-6' };

export function ListGlyph({ icon, color, size = 'md', className }: ListGlyphProps) {
  const line = icon ? LINE_ICONS[icon] : undefined;
  if (line) {
    const { Icon, fg, bg } = line;
    return (
      <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center', SIZES[size], className)} style={{ backgroundColor: bg, color: fg }}>
        <Icon className={ICON_SIZES[size]} strokeWidth={1.75} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center', SIZES[size], className)}
      style={{ backgroundColor: color ? `${color}22` : 'hsl(var(--muted))' }}
    >
      {icon || '📋'}
    </span>
  );
}
