import { useEffect, useRef } from 'react';
import { MapPin, SearchX } from 'lucide-react';
import type { PlaceResult } from '@/hooks/usePlaceAutocomplete';
import { hapticTap } from '@/lib/haptics';

interface PlaceResultsDropdownProps {
  results: PlaceResult[];
  onSelect: (place: PlaceResult) => void;
  onClose: () => void;
  className?: string;
  /** A search is in flight. */
  searching?: boolean;
  /** The last search found nothing. */
  noResults?: boolean;
}

// Placeholder rows shaped like real results, shown while the first search
// is running, so the list appears to fill in rather than pop up late.
function ResultSkeleton() {
  return (
    <div className="px-4 py-3 border-b last:border-b-0" aria-hidden>
      <div className="h-4 w-2/5 rounded bg-muted animate-pulse" />
      <div className="mt-2 h-3 w-4/5 rounded bg-muted/70 animate-pulse" />
    </div>
  );
}

// Shared results list for every "search for a place" dropdown in the app.
// Fixes two mobile-app-feel bugs that kept getting re-introduced by
// copy-pasting this pattern across dialogs:
//
// 1. The list wouldn't scroll on the first touch while the keyboard was
//    still open. Each result is a <button>, and a mousedown's default
//    action is to move focus to whatever's under it - on mobile that steals
//    focus away from the search input mid-gesture, which kicks off the
//    keyboard-dismiss animation and eats the very first scroll/tap on this
//    list. Preventing that default keeps focus where it was until an
//    actual click fires (which still happens normally on mouseup) -
//    the standard fix used by combobox libraries (downshift, MUI
//    Autocomplete, etc.) for this exact bug.
// 2. Nothing closed the dropdown when the user scrolled the page/dialog
//    around it - only selecting a result or clearing the query did, so it
//    could linger on top of the form. Scroll events don't bubble, so this
//    listens on the capture phase at the document level to see scrolls on
//    any nested scroll container, and closes unless the scroll originated
//    inside this dropdown itself.
export function PlaceResultsDropdown({
  results,
  onSelect,
  onClose,
  className,
  searching = false,
  noResults = false,
}: PlaceResultsDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('scroll', handleScroll, true);
    return () => document.removeEventListener('scroll', handleScroll, true);
  }, [onClose]);

  return (
    <div
      ref={ref}
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => e.stopPropagation()}
      className={
        className ??
        'bg-popover border rounded-md shadow-lg max-h-[200px] overflow-y-auto overscroll-contain'
      }
    >
      {/* A thin indeterminate bar while newer results load over older
          ones - the list stays usable instead of blanking out. */}
      {searching && results.length > 0 && (
        <div className="sticky top-0 h-0.5 w-full overflow-hidden bg-primary/10" aria-hidden>
          <div className="h-full w-1/3 bg-primary/60 animate-[search-progress_1s_ease-in-out_infinite]" />
        </div>
      )}
      {searching && results.length === 0 && (
        <>
          <ResultSkeleton />
          <ResultSkeleton />
          <ResultSkeleton />
        </>
      )}
      {noResults && (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
          <SearchX className="h-4 w-4 shrink-0" />
          No places found. You can type the details below.
        </div>
      )}
      {results.map((place) => (
        <button
          key={place.id}
          type="button"
          className={`w-full text-left px-4 py-3 hover:bg-accent active:bg-accent transition-[background-color,opacity] border-b last:border-b-0 ${
            searching ? 'opacity-60' : ''
          }`}
          onClick={() => {
            void hapticTap();
            onSelect(place);
          }}
        >
          <div className="font-medium">{place.name}</div>
          <div className="text-sm text-muted-foreground flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {place.address}
          </div>
        </button>
      ))}
    </div>
  );
}
