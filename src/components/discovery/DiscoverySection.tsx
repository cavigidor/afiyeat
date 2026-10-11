import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DiscoverySectionProps {
  title: string;
  /** One short line under the title saying what this is, honestly. */
  subtitle?: string;
  /** "See all" destination. */
  seeAllTo?: string;
  seeAllLabel?: string;
  children: ReactNode;
  className?: string;
}

/**
 * A titled block on Home or Explore. Every section uses this, so headings,
 * spacing and "See all" links stay identical across the app.
 */
export function DiscoverySection({
  title,
  subtitle,
  seeAllTo,
  seeAllLabel = 'See all',
  children,
  className,
}: DiscoverySectionProps) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight">{title}</h2>
          {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {seeAllTo && (
          <Link
            to={seeAllTo}
            className="active-press shrink-0 flex items-center text-sm font-medium text-primary transition-opacity duration-150 active:opacity-60"
          >
            {seeAllLabel}
            <ChevronRight className="h-4 w-4" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * A horizontally swipeable row of cards that bleeds to the screen edges on
 * phones (so the next card peeks in, signalling there's more) and sits in
 * the content column on wider screens.
 */
export function Rail({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rail gap-3 -mx-4 px-4 scroll-px-4 sm:-mx-6 sm:px-6 sm:scroll-px-6 lg:mx-0 lg:px-0 lg:scroll-px-0 pb-1',
        className,
      )}
    >
      {children}
    </div>
  );
}
