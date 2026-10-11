import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { AnimalAvatar } from '@/components/shared/AnimalAvatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, User, Stamp, ShieldAlert } from 'lucide-react';
import { HOME_PATH, PRIMARY_TABS } from '@/lib/navigation';
import { fetchIsModerator } from '@/lib/moderation';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import logo from '@/assets/logo.png';

async function fetchOwnAvatar(userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('avatar_emoji, avatar_color')
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

// Primary nav on mobile is the fixed bottom tab bar (see BottomTabBar.tsx) -
// these desktop-only links (hidden md:flex below) render from the same
// PRIMARY_TABS list. "You" isn't one of them on desktop; Profile stays
// behind the avatar menu there.
export function Navbar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Shared cache key with Profile.tsx's avatar picker, which writes
  // through to this same query on save - so the menu avatar updates
  // instantly without waiting on a refetch.
  const { data: ownAvatar } = useQuery({
    queryKey: ['profile-avatar', user?.id],
    queryFn: () => fetchOwnAvatar(user!.id),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  // Only moderators see the queue link; everyone else gets false and the
  // item never renders. The server checks the role again on every action.
  const { data: isModerator } = useQuery({
    queryKey: ['is-moderator', user?.id],
    queryFn: fetchIsModerator,
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
  });

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const NavLinks = () => (
    <>
      {PRIMARY_TABS.filter((tab) => tab.desktop).map((tab) => {
        const Icon = tab.icon;
        const active = tab.isActive(location.pathname);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={active ? 'page' : undefined}
            className={`active-press flex items-center gap-2 transition-[color,transform] duration-150 ease-out active:opacity-60 ${
              active ? 'text-foreground font-medium' : 'text-foreground/70 hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </>
  );

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 pt-safe">
      {/* Slimmer on phones: every screen already has its own title, so a
          64px header with a 48px logo was spending a lot of a small screen
          on branding above a bottom tab bar that takes another 56px. */}
      <div className="container flex h-14 sm:h-16 items-center justify-between gap-3">
        <Link to={user ? HOME_PATH : '/'} className="active-press flex items-center gap-2 min-w-0 transition-opacity duration-150 ease-out active:opacity-70">
          <img
            src={logo}
            alt="Afiyeat"
            width={48}
            height={48}
            className="h-9 w-9 sm:h-12 sm:w-12 object-contain shrink-0"
          />
          <span className="font-semibold text-lg sm:text-xl">Afiyeat</span>
        </Link>

        {user && (
          <nav className="hidden md:flex items-center gap-6">
            <NavLinks />
          </nav>
        )}

        <div className="flex items-center gap-4">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                  <AnimalAvatar
                    emoji={ownAvatar?.avatar_emoji}
                    color={ownAvatar?.avatar_color}
                    className="h-10 w-10"
                    emojiClassName="text-xl"
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuItem onClick={() => navigate('/profile')}>
                  <User className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </DropdownMenuItem>
                {/* Passport was only reachable from a card halfway down
                    Profile. Inviting friends deserves one tap from anywhere. */}
                <DropdownMenuItem onClick={() => navigate('/passport')}>
                  <Stamp className="mr-2 h-4 w-4" />
                  <span>Invite friends</span>
                </DropdownMenuItem>
                {isModerator && (
                  <DropdownMenuItem onClick={() => navigate('/moderation')}>
                    <ShieldAlert className="mr-2 h-4 w-4" />
                    <span>Moderation</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            // On a phone there's only room for one button next to the
            // logo - two made the wordmark run straight into "Sign In".
            // Returning users need Sign in in the header; new users get a
            // full-width "Join" in the page itself.
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="ghost" onClick={() => navigate('/auth')}>
                Sign in
              </Button>
              <Button className="hidden sm:inline-flex" onClick={() => navigate('/auth?mode=signup')}>
                Join free
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
