import { useEffect, useRef } from 'react';
import { MapPin } from 'lucide-react';
import type { PlaceResult } from '@/hooks/usePlaceAutocomplete';

interface PlaceResultsDropdownProps {
  results: PlaceResult[];
  onSelect: (place: PlaceResult) => void;
  onClose: () => void;
  className?: string;
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
export function PlaceResultsDropdown({ results, onSelect, onClose, className }: PlaceResultsDropdownProps) {
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
      {results.map((place) => (
        <button
          key={place.id}
          type="button"
          className="w-full text-left px-4 py-3 hover:bg-accent transition-colors border-b last:border-b-0"
          onClick={() => onSelect(place)}
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
