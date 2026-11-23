import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { hapticTap } from '@/lib/haptics';
import { ENABLED_CATEGORIES, exploreCategoryPath, type ExploreSelection } from '@/lib/discovery';

/**
 * Home's quick categories: large, friendly tiles that jump into Explore
 * with that category open. Renders from DISCOVERY_CATEGORIES, so a new
 * category appears here (and in Explore) by adding it there.
 */
export function CategoryTiles() {
  return (
    <nav aria-label="Categories" className="rail gap-2.5 -mx-4 px-4 scroll-px-4 sm:-mx-6 sm:px-6 sm:scroll-px-6 lg:mx-0 lg:px-0 lg:scroll-px-0">
      {ENABLED_CATEGORIES.map((c) => (
        <Link
          key={c.id}
          to={exploreCategoryPath(c.id)}
          onClick={() => void hapticTap()}
          className="active-press group flex min-w-[4.75rem] flex-1 flex-col items-center gap-1.5 transition-transform duration-150 ease-out"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl border bg-card text-3xl shadow-sm transition-colors group-active:bg-muted/60">
            <span aria-hidden>{c.emoji}</span>
          </span>
          <span className="text-xs font-medium text-foreground/80">{c.label}</span>
        </Link>
      ))}
    </nav>
  );
}

interface CategoryChipsProps {
  value: ExploreSelection;
  onChange: (id: ExploreSelection) => void;
}

const ALL_CHIP = { id: 'all' as const, label: 'All', emoji: '✨' };

/** Explore's category switcher: All, then each category; the selected one filled. */
export function CategoryChips({ value, onChange }: CategoryChipsProps) {
  return (
    <div role="tablist" aria-label="Categories" className="rail gap-2 -mx-4 px-4 scroll-px-4 sm:mx-0 sm:px-0 sm:scroll-px-0">
      {[ALL_CHIP, ...ENABLED_CATEGORIES].map((c) => {
        const active = c.id === value;
        return (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (!active) void hapticTap();
              onChange(c.id);
            }}
            className={cn(
              'active-press flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-[background-color,color,border-color,transform] duration-150 ease-out',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card text-foreground/80 active:bg-muted/60',
            )}
          >
            <span aria-hidden>{c.emoji}</span>
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
