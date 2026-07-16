import { useState } from 'react';

export type ViewMode = 'grid' | 'list';

/**
 * Grid/list view preference, persisted per-page in localStorage so it
 * sticks across visits (and across web/app - same codebase, same storage
 * per platform).
 */
export function useViewMode(storageKey: string, defaultMode: ViewMode = 'grid') {
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    try {
      const stored = window.localStorage.getItem(`view_mode_${storageKey}`);
      return stored === 'list' || stored === 'grid' ? stored : defaultMode;
    } catch {
      return defaultMode;
    }
  });

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    try {
      window.localStorage.setItem(`view_mode_${storageKey}`, mode);
    } catch {
      // Private browsing / storage disabled - not worth surfacing an error for.
    }
  };

  return [viewMode, setViewMode] as const;
}
