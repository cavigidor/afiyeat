import { House, Compass, ListChecks, Bell, CircleUserRound, type LucideIcon } from 'lucide-react';

/** Where a signed-in user starts: the app's main screen. */
export const HOME_PATH = '/home';

/** Where the old Foodie tab (Recipes) lives now. */
export const RECIPES_PATH = '/explore?c=food&tab=recipes';

/** Lists -> Shared: the index of shared (two-person) lists. */
export const SHARED_LISTS_PATH = '/my-lists?tab=shared';

/** One shared list. Owned by Lists - the Lists tab stays selected. */
export function sharedListPath(listId: string): string {
  return `/my-lists/shared/${listId}`;
}

export interface PrimaryTab {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Screens that belong to this tab: it's selected whenever one is open. */
  owns: (pathname: string) => boolean;
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
    owns: (p) => p === HOME_PATH,
    desktop: true,
  },
  {
    to: '/explore',
    label: 'Explore',
    icon: Compass,
    owns: (p) => p === '/explore',
    desktop: true,
  },
  {
    to: '/my-lists',
    label: 'Lists',
    icon: ListChecks,
    // My Restaurants, custom lists and shared lists all live under Lists.
    owns: (p) => p === '/my-lists' || p === '/my-list' || p.startsWith('/my-lists/'),
    desktop: true,
  },
  {
    to: '/activity',
    label: 'Activity',
    icon: Bell,
    owns: (p) => p === '/activity',
    desktop: true,
  },
  {
    to: '/profile',
    label: 'You',
    icon: CircleUserRound,
    owns: (p) => p === '/profile' || p === '/passport',
    desktop: false,
  },
];

/**
 * Screens that don't belong to one tab because they're reached from
 * several - search, finding people, someone's profile or public list, a
 * shared place or recipe. Like a pushed screen on iOS, they keep the tab
 * the user came from selected (search from Home stays Home; a public list
 * from Lists -> Discover stays Lists). `fallback` is used only when there
 * is no previous tab, e.g. a cold-start deep link.
 */
const CONTEXTUAL_SCREENS: { matches: (p: string) => boolean; fallback: string | null }[] = [
  { matches: (p) => p === '/search', fallback: '/explore' },
  { matches: (p) => p === '/friends', fallback: '/activity' },
  { matches: (p) => p.startsWith('/lists/discover/'), fallback: '/explore' },
];

// The tab of the last tab-owned screen shown - what a contextual screen
// inherits. Module-level so the bottom bar and every navbar agree.
let lastOwnedTab: string | null = null;

/** Which primary tab is selected for a pathname (`to` of the tab), or null for none. */
export function resolveActiveTab(pathname: string): string | null {
  const owner = PRIMARY_TABS.find((t) => t.owns(pathname));
  if (owner) {
    lastOwnedTab = owner.to;
    return owner.to;
  }
  const contextual = CONTEXTUAL_SCREENS.find((c) => c.matches(pathname));
  if (contextual) return lastOwnedTab ?? contextual.fallback;
  // Any other in-app sub-screen (/u/..., /r/..., /recipe/..., /support,
  // /moderation) is contextual with no fallback.
  return lastOwnedTab;
}
