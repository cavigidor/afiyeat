import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { hapticTap } from '@/lib/haptics';
import { PRIMARY_TABS } from '@/lib/navigation';
import { usePendingRequests } from '@/lib/followRequests';

/**
 * Primary navigation on mobile - a fixed iOS-style bottom tab bar:
 * Home | Explore | Lists | Activity | You (see lib/navigation.ts). Only
 * shown once signed in (matches Navbar's own nav links, which are also
 * gated on `user`).
 *
 * Toggles a body class so index.css can pad page content clear of this
 * bar's height + the safe-area inset, without every single page needing
 * its own bottom-padding change.
 */
export function BottomTabBar() {
  const { user } = useAuth();
  const location = useLocation();
  // The one count that's real today: follow requests waiting on you.
  // There's no read/unread state for anything else, so nothing else badges.
  const { data: pendingRequests = [] } = usePendingRequests(user?.id);

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
      <div className="grid grid-cols-5">
        {PRIMARY_TABS.map((tab) => {
          const active = tab.isActive(location.pathname);
          const Icon = tab.icon;
          const badge = tab.to === '/activity' ? pendingRequests.length : 0;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={active ? 'page' : undefined}
              aria-label={badge > 0 ? `${tab.label}, ${badge} new` : tab.label}
              onClick={() => {
                if (!active) void hapticTap();
              }}
              className={cn(
                'active-press flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] transition-[color,transform] duration-150 ease-out active:opacity-60',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <span className="relative">
                <Icon className={cn('h-5 w-5', active && 'fill-primary/10')} />
                {badge > 0 && (
                  <span
                    aria-hidden
                    className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
                  >
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </span>
              <span className={cn(active && 'font-medium')}>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
