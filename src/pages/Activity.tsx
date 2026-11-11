import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, UserPlus, MessageCircle, Plus } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { AnimalAvatar } from '@/components/shared/AnimalAvatar';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/contexts/AuthContext';
import { usePendingRequests } from '@/lib/followRequests';
import { fetchActivity, type ActivityItem } from '@/lib/activity';
import { timeAgo } from '@/lib/circle';
import { FollowRequestsCard } from '@/components/activity/FollowRequestsCard';
import { sharedListPath } from '@/lib/navigation';

function actorName(item: ActivityItem): string {
  return item.actor.display_name || item.actor.username || 'Someone';
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const navigate = useNavigate();
  const open = () =>
    item.kind === 'follower' ? navigate(`/u/${item.actor.user_id}`) : navigate(sharedListPath(item.listId));

  const Icon = item.kind === 'follower' ? UserPlus : item.kind === 'shared_add' ? Plus : MessageCircle;

  return (
    <li>
      <button
        type="button"
        onClick={open}
        className="active-press flex w-full items-start gap-3 px-4 py-3 text-left transition-[background-color,transform] duration-150 ease-out active:bg-muted/60"
      >
        <span className="relative shrink-0">
          <AnimalAvatar emoji={item.actor.avatar_emoji} color={item.actor.avatar_color} className="h-10 w-10" />
          <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground">
            <Icon className="h-2.5 w-2.5" />
          </span>
        </span>
        <span className="min-w-0 flex-1 text-sm leading-snug">
          <span className="font-medium">{actorName(item)}</span>{' '}
          <span className="text-muted-foreground">
            {item.kind === 'follower' && 'started following you'}
            {item.kind === 'shared_add' && (
              <>
                added <span className="font-medium text-foreground">{item.itemName}</span> to{' '}
                <span className="font-medium text-foreground">{item.listName}</span>
              </>
            )}
            {item.kind === 'shared_comment' && (
              <>
                commented on <span className="font-medium text-foreground">{item.itemName}</span>
              </>
            )}
          </span>
          {item.kind === 'shared_comment' && (
            <span className="mt-1 block line-clamp-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-foreground/90">
              {item.comment}
            </span>
          )}
        </span>
        <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">{timeAgo(item.at)}</span>
      </button>
    </li>
  );
}

/**
 * Activity: "what's happening in my network?" Follow requests that need
 * an answer first, then the last 30 days of things that happened to you -
 * new followers, and what your shared-list partners added or said. A way
 * to find people sits at the top, since that's what fills this screen.
 */
export default function Activity() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { data: requests = [] } = usePendingRequests(user?.id);
  const { data: feed = [], isLoading } = useQuery({
    queryKey: ['activity', user?.id],
    queryFn: () => fetchActivity(user!.id),
    enabled: !!user,
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [user, authLoading, navigate]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container max-w-2xl py-4 sm:py-8 px-4 sm:px-6 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl sm:text-3xl font-bold">Activity</h1>
          <Button asChild size="sm" variant="outline" className="rounded-full gap-1.5">
            <Link to="/friends">
              <UserPlus className="h-4 w-4" />
              Find people
            </Link>
          </Button>
        </div>

        {requests.length > 0 && <FollowRequestsCard userId={user.id} requests={requests} />}

        <section className="space-y-3" aria-label="Recent activity">
          {requests.length > 0 && <h2 className="text-lg font-semibold">Recent</h2>}
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : feed.length === 0 ? (
            <div className="rounded-2xl border bg-card px-6 py-12 text-center shadow-sm">
              <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bell className="h-6 w-6" />
              </span>
              <h3 className="text-base font-medium mb-1">Nothing new yet</h3>
              <p className="text-sm text-muted-foreground mb-5">
                New followers and what friends add to your shared lists will show up here.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild size="sm">
                  <Link to="/friends">Find people to follow</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/my-lists?tab=shared">Start a shared list</Link>
                </Button>
              </div>
            </div>
          ) : (
            <ul className="divide-y rounded-2xl border bg-card shadow-sm overflow-hidden">
              {feed.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
