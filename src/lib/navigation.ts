import { House, Compass, ListChecks, Bell, CircleUserRound, type LucideIcon } from 'lucide-react';

/** Where a signed-in user starts: the app's main screen. */
export const HOME_PATH = '/home';

/** Where the old Foodie tab (Recipes) lives now. */
export const RECIPES_PATH = '/explore?c=food&tab=recipes';

export interface PrimaryTab {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Whether this tab is the current section for a pathname. */
  isActive: (pathname: string) => boolean;
  /** Shown in the desktop navbar too (You stays behind the avatar menu there). */
  desktop: boolean;
}

/**
 * The five sections of the app, in tab-bar order. BottomTabBar (phones) and
 * Navbar (desktop) both render from this, so the two can't drift apart.
 *
 * Labels are what people see; routes keep their older names (/my-lists,
 * /profile) so existing links and history entries keep working.
 */
export const PRIMARY_TABS: PrimaryTab[] = [
  {
    to: HOME_PATH,
    label: 'Home',
    icon: House,
    isActive: (p) => p === HOME_PATH,
    desktop: true,
  },
  {
    to: '/explore',
    label: 'Explore',
    icon: Compass,
    isActive: (p) => p === '/explore' || p === '/search',
    desktop: true,
  },
  {
    to: '/my-lists',
    label: 'Lists',
    icon: ListChecks,
    isActive: (p) => p === '/my-lists' || p === '/my-list' || p.startsWith('/my-lists/'),
    desktop: true,
  },
  {
    to: '/activity',
    label: 'Activity',
    icon: Bell,
    isActive: (p) => p === '/activity' || p === '/friends',
    desktop: true,
  },
  {
    to: '/profile',
    label: 'You',
    icon: CircleUserRound,
    isActive: (p) => p === '/profile' || p === '/passport',
    desktop: false,
  },
];
