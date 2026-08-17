import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Newspaper, ListChecks, Users, Compass } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

interface Tab {
  to: string;
  label: string;
  icon: typeof Newspaper;
  isActive: (pathname: string) => boolean;
}

const TABS: Tab[] = [
  {
    to: '/foodie',
    label: 'Foodie',
    icon: Newspaper,
    isActive: (p) => p === '/foodie' || p === '/news' || p === '/recipes',
  },
  {
    to: '/my-lists',
    label: 'My Lists',
    icon: ListChecks,
    isActive: (p) => p === '/my-lists' || p === '/my-list' || p.startsWith('/my-lists/'),
  },
  {
    to: '/friends',
    label: 'Friends',
    icon: Users,
    isActive: (p) => p === '/friends',
  },
  {
    to: '/explore',
    label: 'Explore',
    icon: Compass,
    isActive: (p) => p === '/explore',
  },
];

/**
 * Primary navigation on mobile - a fixed iOS-style bottom tab bar, replacing
 * the old hamburger drawer. Only shown once signed in (matches Navbar's own
 * nav links, which are also gated on `user`).
 *
 * Toggles a body class so index.css can pad page content clear of this
 * bar's height + the safe-area inset, without every single page needing
 * its own bottom-padding change.
 */
export function BottomTabBar() {
  const { user } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (user) {
      document.body.classList.add('has-bottom-tabs');
    } else {
      document.body.classList.remove('has-bottom-tabs');
    }
    return () => {
      document.body.classList.remove('has-bottom-tabs');
    };
  }, [user]);

  if (!user) return null;

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 border-t border-border/40 pb-safe"
      aria-label="Primary"
    >
      <div className="grid grid-cols-4">
        {TABS.map((tab) => {
          const active = tab.isActive(location.pathname);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 py-2 text-xs transition-colors',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon className={cn('h-5 w-5', active && 'fill-primary/10')} />
              <span className={cn(active && 'font-medium')}>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
