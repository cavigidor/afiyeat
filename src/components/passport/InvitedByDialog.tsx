import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AnimalAvatar } from '@/components/shared/AnimalAvatar';
import { Loader2, UserPlus, Check } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { hapticSuccess } from '@/lib/haptics';
import type { ReferrerInfo } from '@/lib/passport';

/**
 * Shown once, right after a new account is credited to the person whose
 * link brought them in: "Cem invited you to Afiyeat", with a one-tap
 * Follow.
 *
 * Only ever shown when the server confirmed the referral, so the name is
 * the real inviter, never a guess. Following is offered, not done for
 * them - a new user shouldn't find they've been signed up to follow
 * someone without choosing to.
 */
export function InvitedByDialog({
  inviter,
  onClose,
}: {
  inviter: ReferrerInfo;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [state, setState] = useState<'idle' | 'working' | 'following' | 'requested'>('idle');
  const name = inviter.display_name?.trim() || inviter.username || 'A friend';
  const firstName = name.split(' ')[0];

  const handleFollow = async () => {
    if (!user) return;
    setState('working');
    // Status (accepted, or pending for a private profile) is decided by the
    // database, not by us - see enforce_follow_status.
    const { data, error } = await supabase
      .from('follows')
      .insert({ follower_id: user.id, following_id: inviter.user_id })
      .select('status')
      .maybeSingle();

    if (error && error.code !== '23505') {
      setState('idle');
      toast.error('Couldn\'t follow right now. You can find them in Friends later.');
      return;
    }
    void hapticSuccess();
    void queryClient.invalidateQueries();
    setState(data?.status === 'pending' ? 'requested' : 'following');
  };

  const done = state === 'following' || state === 'requested';

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader className="items-center text-center">
          <AnimalAvatar
            emoji={inviter.avatar_emoji}
            color={inviter.avatar_color}
            className="h-16 w-16 mb-2"
            emojiClassName="text-3xl"
          />
          <DialogTitle>{name} invited you to Afiyeat</DialogTitle>
          <DialogDescription>
            Follow {firstName} to see the places and recipes they save. Once you've saved a few of
            your own, you'll both get a Passport stamp.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {done ? (
            <Button onClick={onClose}>
              <Check className="h-4 w-4 mr-2" />
              {state === 'requested' ? 'Request sent — continue' : `Following ${firstName} — continue`}
            </Button>
          ) : (
            <>
              <Button onClick={handleFollow} disabled={state === 'working'}>
                {state === 'working' ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4 mr-2" />
                )}
                Follow {firstName}
              </Button>
              <Button variant="ghost" onClick={onClose} disabled={state === 'working'}>
                Not now
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
