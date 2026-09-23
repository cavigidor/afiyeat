import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AnimalAvatar } from '@/components/shared/AnimalAvatar';
import { SearchX } from 'lucide-react';
import { setReturnTo } from '@/lib/passport';
import { ownerName, type SharedOwner } from '@/lib/sharedPreview';

/**
 * "Saved by …" - who the shared content belongs to. Links to their
 * profile only for signed-in viewers, since profiles aren't readable
 * without an account.
 */
export function OwnerByline({
  owner,
  verb = 'Saved by',
  linkToProfile,
}: {
  owner: SharedOwner;
  verb?: string;
  linkToProfile: boolean;
}) {
  const inner = (
    <span className="flex items-center gap-2 min-w-0">
      <AnimalAvatar
        emoji={owner.avatar_emoji}
        color={owner.avatar_color}
        className="h-7 w-7 shrink-0"
        emojiClassName="text-sm"
      />
      <span className="text-sm text-muted-foreground truncate">
        {verb} <span className="font-medium text-foreground">{ownerName(owner)}</span>
      </span>
    </span>
  );
  return linkToProfile ? (
    <Link to={`/u/${owner.user_id}`} className="active-press inline-flex max-w-full">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/**
 * The invitation shown to someone who opened a shared link without an
 * account. It sits under the content rather than in front of it - they
 * were sent this dish or place, so they see it first, and the offer to
 * join is about keeping it.
 */
export function JoinAfiyeatCta({ owner, what }: { owner: SharedOwner; what: string }) {
  const navigate = useNavigate();
  const location = useLocation();

  const go = (mode: 'signup' | 'signin') => {
    // Land back here after signing up, not on a generic home screen.
    setReturnTo(location.pathname);
    navigate(mode === 'signup' ? '/auth?mode=signup' : '/auth');
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-5 space-y-3">
        <div>
          <p className="font-semibold">Keep {what} on your own food map</p>
          <p className="text-sm text-muted-foreground mt-1">
            Afiyeat is where {ownerName(owner)} keeps the places and recipes worth remembering.
            Join free to save this, follow them, and start your own.
          </p>
        </div>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => go('signup')}>
            Join Afiyeat
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => go('signin')}>
            Sign in
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Shown when a link points at something private, deleted, or mistyped. */
export function SharedNotAvailable({ what }: { what: string }) {
  const navigate = useNavigate();
  return (
    <div className="text-center py-16 px-4">
      <SearchX className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
      <h2 className="text-lg font-semibold mb-1">This {what} isn't available</h2>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto">
        It may be private, or it may have been removed. If a friend sent it to you, ask them to
        check their sharing settings.
      </p>
      <Button variant="outline" className="mt-5" onClick={() => navigate('/')}>
        Go to Afiyeat
      </Button>
    </div>
  );
}
