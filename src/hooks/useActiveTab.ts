import { useLocation } from 'react-router-dom';
import { resolveActiveTab } from '@/lib/navigation';

/** The selected primary tab (its `to` path) for the current screen, or null. */
export function useActiveTab(): string | null {
  const { pathname } = useLocation();
  return resolveActiveTab(pathname);
}
