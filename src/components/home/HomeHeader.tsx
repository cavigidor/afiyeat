import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Up late?';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Top of Home: a greeting, the one-line promise of the screen, and the
 * search entry. Search here is a doorway to the full search screen (places,
 * people, lists) rather than an inline field, so typing gets the whole
 * screen and the keyboard never covers Home's content.
 */
export function HomeHeader() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">{greeting()}</h1>
        <p className="text-muted-foreground mt-0.5">What's worth checking out?</p>
      </div>
      <Link
        to="/search"
        className="active-press flex h-12 w-full items-center gap-3 rounded-full border bg-card px-4 text-muted-foreground shadow-sm transition-[background-color,transform] duration-150 ease-out active:bg-muted/60"
      >
        <Search className="h-5 w-5 shrink-0" />
        <span className="truncate">Search places, people, lists…</span>
      </Link>
    </div>
  );
}
