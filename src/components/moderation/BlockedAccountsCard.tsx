import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AnimalAvatar } from '@/components/shared/AnimalAvatar';
import { Ban, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { fetchBlockedUsers, unblockUser } from '@/lib/moderation';

/**
 * The blocked-accounts list, shown on Profile.
 *
 * Blocking is only half a feature without somewhere to undo it, and the
 * block confirmation explicitly promises this screen exists. App Review
 * also looks for it: being able to block but never unblock reads as a
 * trap.
 */
export function BlockedAccountsCard() {
  const queryClient = useQueryClient();

  const { data: blocked = [], isLoading } = useQuery({
    queryKey: ['blocked-users'],
    queryFn: fetchBlockedUsers,
    staleTime: 60 * 1000,
  });

  const handleUnblock = async (userId: string) => {
    const result = await unblockUser(userId);
    if (!result.ok) {
      toast.error(result.message ?? 'Couldn\'t unblock.');
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
    void queryClient.invalidateQueries({ queryKey: ['has-blocked', userId] });
    toast.success('Unblocked');
  };

  // Nothing blocked is the normal case - don't take up room on the
  // settings screen describing a list that isn't there.
  if (!isLoading && blocked.length === 0) return null;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Ban className="h-4 w-4" />
          Blocked accounts
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {blocked.map((entry) => (
              <div
                key={entry.userId}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <AnimalAvatar
                    emoji={entry.profile?.avatar_emoji}
                    color={entry.profile?.avatar_color}
                    className="h-9 w-9 shrink-0"
                    emojiClassName="text-base"
                  />
                  <div className="min-w-0">
                    {/* The block policy hides the blocked person's profile
                        row from this very query, so names usually come
                        back empty. That's intended - the list stays
                        manageable without putting someone you blocked back
                        in front of you. */}
                    <p className="text-sm font-medium truncate">
                      {entry.profile?.display_name || entry.profile?.username || 'Blocked account'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Blocked {new Date(entry.blockedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => handleUnblock(entry.userId)}>
                  Unblock
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
