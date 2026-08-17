import { Link, useNavigate } from 'react-router-dom';
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
import { Users, LogOut, User, ListChecks, Newspaper, Compass } from 'lucide-react';
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
// these desktop-only links (hidden md:flex below) mirror the same four
// destinations for consistency. Profile intentionally isn't one of them;
// it stays behind the avatar menu on both breakpoints.
export function Navbar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  // Shared cache key with Profile.tsx's avatar picker, which writes
  // through to this same query on save - so the menu avatar updates
  // instantly without waiting on a refetch.
  const { data: ownAvatar } = useQuery({
    queryKey: ['profile-avatar', user?.id],
    queryFn: () => fetchOwnAvatar(user!.id),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const NavLinks = () => (
    <>
      <Link
        to="/foodie"
        className="flex items-center gap-2 text-foreground/80 hover:text-foreground transition-colors"
      >
        <Newspaper className="h-4 w-4" />
        <span>Foodie</span>
      </Link>
      <Link
        to="/my-lists"
        className="flex items-center gap-2 text-foreground/80 hover:text-foreground transition-colors"
      >
        <ListChecks className="h-4 w-4" />
        <span>My Lists</span>
      </Link>
      <Link
        to="/friends"
        className="flex items-center gap-2 text-foreground/80 hover:text-foreground transition-colors"
      >
        <Users className="h-4 w-4" />
        <span>Friends</span>
      </Link>
      <Link
        to="/explore"
        className="flex items-center gap-2 text-foreground/80 hover:text-foreground transition-colors"
      >
        <Compass className="h-4 w-4" />
        <span>Explore</span>
      </Link>
    </>
  );

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 pt-safe">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <img src={logo} alt="Afiyeat" className="h-12 w-12 object-contain" />
          <span className="font-semibold text-xl">Afiyeat</span>
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
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => navigate('/auth')}>
                Sign In
              </Button>
              <Button onClick={() => navigate('/auth?mode=signup')}>
                Get Started
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
