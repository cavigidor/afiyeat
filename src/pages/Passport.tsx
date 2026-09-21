import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Copy, Share2, Check, Stamp } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { hapticSuccess } from '@/lib/haptics';
import {
  MILESTONES,
  currentMilestone,
  fetchPassportSummary,
  inviteUrl,
  nextMilestone,
} from '@/lib/passport';

/**
 * Afiyeat Passport - the invite screen.
 *
 * Framed as a record of who you've brought to the table rather than a
 * balance to be spent. There's no points total, no leaderboard and
 * nothing to redeem, because the moment stamps look like currency the
 * whole thing reads as a crypto airdrop and attracts exactly the users
 * who make a food app worse.
 */
export default function Passport() {
  const { user } = useAuth();

  const { data: summary, isLoading } = useQuery({
    queryKey: ['passport-summary', user?.id],
    queryFn: fetchPassportSummary,
    enabled: !!user,
    staleTime: 60 * 1000,
  });

  const qualified = summary?.qualifiedCount ?? 0;
  const pending = summary?.pendingCount ?? 0;
  const code = summary?.referralCode ?? null;
  const url = code ? inviteUrl(code) : '';
  const reached = currentMilestone(qualified);
  const next = nextMilestone(qualified);

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Invite link copied');
    } catch {
      toast.error('Couldn\'t copy. Long-press the link to copy it manually.');
    }
  };

  const handleShare = async () => {
    if (!url) return;
    // navigator.share is the real iOS share sheet inside the WebView - no
    // plugin needed. Falls back to copying where it isn't available.
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'Afiyeat',
          text: 'Food is better with friends — come build your food map with me on Afiyeat.',
          url,
        });
        void hapticSuccess();
        return;
      } catch {
        // Cancelling the share sheet lands here; not an error worth
        // telling anyone about.
        return;
      }
    }
    void handleCopy();
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container py-4 sm:py-8 px-4 sm:px-6 lg:px-8 max-w-2xl space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Afiyeat Passport</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Food is better with friends. Invite yours, and earn a stamp when they start building
            their own food journey.
          </p>
        </div>

        {isLoading ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : (
          <Card>
            <CardContent className="p-5 space-y-5">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold">{qualified}</span>
                <span className="text-muted-foreground">
                  {qualified === 1 ? 'friend joined' : 'friends joined'}
                </span>
              </div>

              {/* Signed up but not yet active. Shown rather than hidden so
                  an invite that landed doesn't look like it vanished. */}
              {pending > 0 && (
                <p className="text-sm text-muted-foreground">
                  {pending} more {pending === 1 ? 'friend is' : 'friends are'} getting started —
                  their stamp lands once they've saved a few places.
                </p>
              )}

              {next ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">Next: {next.name}</span>
                    <span className="text-muted-foreground">
                      {qualified} / {next.threshold}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                      style={{
                        width: `${Math.min(100, (qualified / next.threshold) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{next.blurb}</p>
                </div>
              ) : (
                <p className="text-sm font-medium">
                  You've reached every milestone. Thank you, genuinely.
                </p>
              )}

              <div className="space-y-2 pt-1">
                <p className="text-xs text-muted-foreground">Your invite link</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 truncate rounded-md bg-muted px-3 py-2 text-sm">
                    {url || '—'}
                  </code>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={handleCopy} disabled={!url}>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy
                  </Button>
                  <Button className="flex-1" onClick={handleShare} disabled={!url}>
                    <Share2 className="h-4 w-4 mr-2" />
                    Invite friends
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Milestones</h2>
          {MILESTONES.map((milestone) => {
            const earned = qualified >= milestone.threshold;
            return (
              <Card key={milestone.id} className={earned ? 'border-primary/40' : undefined}>
                <CardContent className="p-4 flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                      earned ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground/60'
                    }`}
                  >
                    {earned ? <Check className="h-4 w-4" /> : <Stamp className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{milestone.name}</span>
                      {earned && (
                        <Badge variant="secondary" className="text-xs">
                          Earned
                        </Badge>
                      )}
                      {reached?.id === milestone.id && (
                        <Badge className="text-xs">Current</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{milestone.blurb}</p>
                    <p className="text-xs text-muted-foreground/80 mt-1">
                      {milestone.threshold}{' '}
                      {milestone.threshold === 1 ? 'friend' : 'friends'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground pb-2">
          A stamp is earned when a friend you invited creates an account and starts using Afiyeat —
          saving a few places, adding a recipe, or building a list — within their first week.
        </p>
      </main>
    </div>
  );
}
