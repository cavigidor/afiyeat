import { cn } from '@/lib/utils';

interface SpinnerProps {
  className?: string;
  /** Read out by screen readers. */
  label?: string;
}

const SPOKES = 8;

/**
 * The iOS-style activity indicator: eight spokes fading in turn, in the
 * current text colour. Replaces the spinning-arc icon, which reads as a
 * web page loading rather than an app working. Size it with the usual
 * height and width classes (e.g. h-4 w-4); any `animate-spin` passed in is ignored, since the
 * spokes animate themselves rather than rotating.
 */
export function Spinner({ className, label = 'Loading' }: SpinnerProps) {
  const classes = cn('ios-spinner relative inline-block h-5 w-5 shrink-0', className)
    .split(' ')
    .filter((c) => c !== 'animate-spin')
    .join(' ');

  return (
    <span role="status" aria-label={label} className={classes}>
      {Array.from({ length: SPOKES }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className="ios-spinner-spoke"
          style={{
            transform: `rotate(${(360 / SPOKES) * i}deg)`,
            animationDelay: `${-((SPOKES - i) / SPOKES)}s`,
          }}
        />
      ))}
    </span>
  );
}
