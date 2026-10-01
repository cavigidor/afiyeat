import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/layout/Navbar';
import { useAuth } from '@/contexts/AuthContext';
import { isNative } from '@/lib/native';
import {
  ArrowRight,
  Bookmark,
  Map as MapIcon,
  Users,
  ChefHat,
  ListPlus,
  Stamp,
  Check,
  Clock,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { Seo } from '@/components/Seo';

// Set this to the App Store listing URL once the iPhone app is live. Until
// then the download button stays hidden - the page shouldn't advertise an
// app people can't actually get.
const APP_STORE_URL = '';

interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
}

// Each of these describes something the app does today. Keep it that way:
// a landing page that promises features which aren't there yet is the
// fastest way to lose someone on their first visit.
const FEATURES: Feature[] = [
  {
    icon: Bookmark,
    title: 'Never forget a great restaurant',
    body:
      'Save the places you want to try and mark them when you’ve been. Add a rating, notes and photos, and tag them your way — bar, café, date night.',
  },
  {
    icon: MapIcon,
    title: 'Build your food map',
    body:
      'Every place you save lands on your own map. See what’s near you, and get directions in one tap.',
  },
  {
    icon: Users,
    title: 'Discover food through friends',
    body:
      'Follow friends to see where they eat and what they’re saving, and explore what people are adding near you.',
  },
  {
    icon: ChefHat,
    title: 'Save and share recipes',
    body:
      'Keep your recipes in one place. Snap a photo of a recipe and Afiyeat fills it in for you.',
  },
];

// The list presets that exist in the New List screen.
const LIST_EXAMPLES = ['🍷 Wines', '☕ Coffee shops', '🍺 Beers', '🎵 Concerts', '📚 Books', '🎬 Movies', '📺 Shows'];

/**
 * A small illustration of the app's own cards - a restaurant, a wine, a
 * book - showing the idea in one glance instead of describing it. Purely
 * decorative; built from the same tokens as the real cards so it looks
 * like the app rather than a stock graphic.
 */
function HeroPreview() {
  // The staggered offset only applies from tablet width up: on a phone the
  // cards already span the screen, and nudging them sideways pushed the
  // last one against the edge.
  const rows = [
    { emoji: '🍜', name: 'Corner noodle bar', meta: 'Want to go', icon: Clock, offset: 'sm:-translate-x-3' },
    { emoji: '🍷', name: 'Nebbiolo, 2019', meta: '8/10', icon: Star, offset: '' },
    { emoji: '📚', name: 'Salt, Fat, Acid, Heat', meta: 'Reading', icon: Check, offset: 'sm:translate-x-3' },
  ];
  return (
    <div aria-hidden className="mx-auto w-full max-w-sm space-y-2.5">
      {rows.map((row) => (
        <div
          key={row.name}
          className={`flex items-center gap-3 rounded-2xl border bg-card/90 p-3 shadow-sm backdrop-blur ${row.offset}`}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xl">
            {row.emoji}
          </div>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-left">{row.name}</p>
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            <row.icon className="h-3 w-3" />
            {row.meta}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Index() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  // This page is a marketing landing page for afiyeat.com, and exactly
  // wrong inside the app: the native app opens on "/", so the redirect has
  // to happen during render (not in an effect, which runs after the first
  // paint) or every cold launch flashes this page on the way to the app.
  // `replace` keeps it out of history so going back doesn't return to it.
  if (isNative()) {
    // Auth hasn't resolved yet - render nothing. The native splash screen
    // is still covering the webview (see NativeLaunchGate in App.tsx).
    if (loading) return null;
    return <Navigate to={user ? '/foodie' : '/auth'} replace />;
  }

  // On the web, keep serving the landing page to visitors and crawlers -
  // but a signed-in visitor belongs in the app, not the pitch.
  if (!loading && user) {
    return <Navigate to="/foodie" replace />;
  }

  const join = () => navigate('/auth?mode=signup');

  return (
    <div className="min-h-screen bg-background">
      <Seo
        title="Afiyeat — Your food journey, all in one place"
        description="Save restaurants you want to try, remember the ones you loved, keep your recipes, and see where your friends eat. Free restaurant tracker, food map and recipe app."
        path="/"
      />
      <Navbar />

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-accent/15 to-background" />
          <div className="container relative px-4 sm:px-6 lg:px-8 pt-10 pb-14 sm:pt-20 sm:pb-24">
            <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
              <div className="text-center lg:text-left">
                <h1 className="text-[2.15rem] leading-[1.1] sm:text-5xl lg:text-6xl font-bold tracking-tight">
                  Your food journey,
                  <span className="block text-primary">all in one place</span>
                </h1>
                <p className="mt-5 text-base sm:text-lg text-muted-foreground max-w-xl mx-auto lg:mx-0">
                  Save the restaurants you want to try, remember the ones you loved, keep your
                  recipes, and see where your friends are eating.
                </p>
                <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                  <Button size="lg" className="text-base px-7" onClick={join}>
                    Join Afiyeat — it’s free
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => navigate('/auth')}>
                    I already have an account
                  </Button>
                </div>
                {APP_STORE_URL && (
                  <a
                    href={APP_STORE_URL}
                    className="active-press mt-5 inline-flex items-center rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
                  >
                    Download on the App Store
                  </a>
                )}
              </div>
              <HeroPreview />
            </div>
          </div>
        </section>

        {/* What it does */}
        <section className="py-14 sm:py-20">
          <div className="container px-4 sm:px-6 lg:px-8">
            <div className="grid gap-4 sm:grid-cols-2 lg:gap-6 max-w-5xl mx-auto">
              {FEATURES.map((feature) => (
                <div key={feature.title} className="rounded-2xl border bg-card p-6">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                    <feature.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="text-lg font-semibold">{feature.title}</h2>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{feature.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Lists for everything else */}
        <section className="py-14 sm:py-20 bg-card border-y">
          <div className="container px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto text-center">
            <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
              <ListPlus className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold">Lists for everything else, too</h2>
            <p className="mt-3 text-muted-foreground">
              Not just restaurants. Keep the wines, coffee shops and concerts you want to remember —
              each set up in one tap, with the right fields for what it is.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {LIST_EXAMPLES.map((example) => (
                <span key={example} className="rounded-full border bg-background px-3.5 py-1.5 text-sm">
                  {example}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Food is better with friends */}
        <section className="py-14 sm:py-20">
          <div className="container px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto text-center">
            <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
              <Stamp className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold">Food is better with friends</h2>
            <p className="mt-3 text-muted-foreground">
              Send a friend a place or a recipe and they can open it straight away, even without an
              account. When friends you invite join and start their own map, you collect stamps in
              your Afiyeat Passport.
            </p>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="pb-16 sm:pb-24">
          <div className="container px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-3xl rounded-3xl bg-primary px-6 py-10 sm:p-14 text-center">
              <h2 className="text-2xl sm:text-3xl font-bold text-primary-foreground">
                Start your food map
              </h2>
              <p className="mt-3 text-primary-foreground/85 max-w-md mx-auto">
                Free, and it takes a minute. Your first saved place is the start of it.
              </p>
              <Button
                size="lg"
                className="mt-7 bg-background text-foreground hover:bg-background/90 active:bg-background/80"
                onClick={join}
              >
                Create your free account
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="py-8 border-t">
        <div className="container text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} Afiyeat</p>
          {/* Link, not <a href>: a plain anchor reloads the whole app. */}
          <div className="flex justify-center gap-4 mt-2">
            <Link to="/terms" className="hover:text-foreground transition-colors">
              Terms of Service
            </Link>
            <span aria-hidden>·</span>
            <Link to="/privacy" className="hover:text-foreground transition-colors">
              Privacy Policy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
