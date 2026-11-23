import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AnimalAvatar } from '@/components/shared/AnimalAvatar';
import { acceptFollowRequest, declineFollowRequest, type PendingRequest } from '@/lib/followRequests';
import { hapticSuccess } from '@/lib/haptics';
import { timeAgo } from '@/lib/circle';

/**
 * Follow requests waiting on you, answerable in place. The same requests
 * (same cache entry) as Profile's "Review" dialog and the Activity tab's
 * badge, so answering here clears both.
 */
export function FollowRequestsCard({ userId, requests }: { userId: string; requests: PendingRequest[] }) {
  const queryClient = useQueryClient();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['pending-requests', userId] });
    void queryClient.invalidateQueries({ queryKey: ['profile-stats', userId] });
    void queryClient.invalidateQueries({ queryKey: ['activity', userId] });
  };

  const accept = async (r: PendingRequest) => {
    const { error } = await acceptFollowRequest(r.id);
    if (error) {
      toast.error('Failed to accept request');
      return;
    }
    void hapticSuccess();
    toast.success(`${r.profile.display_name || r.profile.username || 'They'} can now see your places`);
    refresh();
  };

  const decline = async (r: PendingRequest) => {
    const { error } = await declineFollowRequest(r.id);
    if (error) {
      toast.error('Failed to decline request');
      return;
    }
    toast.success('Request declined');
    refresh();
  };

  return (
    <section className="space-y-3" aria-label="Follow requests">
      <h2 className="text-lg font-semibold">
        Follow requests <span className="text-muted-foreground font-normal">· {requests.length}</span>
      </h2>
      <ul className="divide-y rounded-2xl border border-primary/30 bg-card shadow-sm">
        {requests.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-4 py-3">
            <Link to={`/u/${r.follower_id}`} className="flex min-w-0 flex-1 items-center gap-3">
              <AnimalAvatar emoji={r.profile.avatar_emoji} color={r.profile.avatar_color} className="h-10 w-10" />
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {r.profile.display_name || r.profile.username}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {r.profile.username ? `@${r.profile.username} · ` : ''}
                  {timeAgo(r.created_at)}
                </span>
              </span>
            </Link>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" onClick={() => void accept(r)} aria-label="Accept">
                <Check className="h-4 w-4 min-[380px]:mr-1" />
                <span className="hidden min-[380px]:inline">Accept</span>
              </Button>
              <Button size="sm" variant="outline" onClick={() => void decline(r)} aria-label="Decline">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
