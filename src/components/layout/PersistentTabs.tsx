import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useLocation } from 'react-router-dom';
import Foodie from '@/pages/Foodie';
import MyLists from '@/pages/MyLists';
import Friends from '@/pages/Friends';
import Explore from '@/pages/Explore';

// The four bottom-tab destinations (see BottomTabBar.tsx/Navbar.tsx). These
// are exactly the routes App.tsx renders as `element={null}` - this
// component is what actually renders their content, as siblings kept
// mounted in the DOM rather than as normal <Route> elements that get torn
// down and rebuilt on every switch.
const TAB_PAGES: Record<string, ComponentType> = {
  '/foodie': Foodie,
  '/my-lists': MyLists,
  '/friends': Friends,
  '/explore': Explore,
};
const TAB_PATHS = Object.keys(TAB_PAGES);

/**
 * Renders each bottom-tab page into its own always-mounted div, toggling
 * visibility with `display` instead of mounting/unmounting on navigation.
 * This is what makes tab switching feel instant rather than like loading a
 * new page: each tab keeps its own component state, scroll position, open
 * filters, in-flight/cached queries, etc. exactly as the user left them.
 *
 * A tab is only added to the DOM the first time the user actually visits
 * it (not all four eagerly on app load) - so first paint and initial data
 * fetching stay limited to whichever tab the user actually opens.
 */
export function PersistentTabs() {
  const location = useLocation();
  const activePath = TAB_PATHS.includes(location.pathname) ? location.pathname : null;
  const [visited, setVisited] = useState<Set<string>>(
    () => new Set(activePath ? [activePath] : []),
  );
  const scrollPositions = useRef<Record<string, number>>({});
  const prevActiveRef = useRef<string | null>(null);

  useEffect(() => {
    if (activePath && !visited.has(activePath)) {
      setVisited((prev) => new Set(prev).add(activePath));
    }
  }, [activePath, visited]);

  // Save the scroll position of the tab being left, then restore whatever
  // was saved for the tab being entered (0 the first time). Content height
  // of a freshly-shown tab can still be settling (images, async data), so
  // restoring on the next animation frame - rather than synchronously -
  // gives layout a beat to catch up before we scroll into it.
  useEffect(() => {
    const prev = prevActiveRef.current;
    if (prev && prev !== activePath) {
      scrollPositions.current[prev] = window.scrollY;
    }
    prevActiveRef.current = activePath;

    if (!activePath) return;

    const targetY = scrollPositions.current[activePath] ?? 0;
    const raf = requestAnimationFrame(() => {
      window.scrollTo(0, targetY);
      // Mapbox GL (and some other canvas-based widgets used across these
      // tabs) can end up with a stale canvas size if it was last measured
      // while its container was hidden (display:none reports a 0x0 box).
      // A resize event is the standard nudge for it - and any other
      // ResizeObserver/listener-based widget - to re-measure now that the
      // tab is visible again.
      window.dispatchEvent(new Event('resize'));
    });
    return () => cancelAnimationFrame(raf);
  }, [activePath]);

  if (visited.size === 0) return null;

  return (
    <>
      {Array.from(visited).map((path) => {
        const Page = TAB_PAGES[path];
        return (
          <div key={path} style={{ display: path === activePath ? 'block' : 'none' }}>
            <Page />
          </div>
        );
      })}
    </>
  );
}
