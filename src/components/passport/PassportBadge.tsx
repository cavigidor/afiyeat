import { useQuery } from '@tanstack/react-query';
import { Stamp } from 'lucide-react';
import { currentMilestone, fetchQualifiedReferralCount, hasPerk } from '@/lib/passport';
import { cn } from '@/lib/utils';

/**
 * The Passport milestone shown next to someone's name on a profile, e.g.
 * "Local Foodie". Renders nothing below the first milestone, so most
 * profiles look exactly as before - the badge is recognition, not a
 * label everyone carries.
 *
 * Styling steps up with the milestones (the "profile accent" perk), but
 * stays a small chip: it should read as a nice detail, never as a rank
 * that makes people without one feel like second-class users.
 */
export function PassportBadge({ userId, className }: { userId: string; className?: string }) {
  const { data: count = 0 } = useQuery({
    queryKey: ['passport-referral-count', userId],
    queryFn: () => fetchQualifiedReferralCount(userId),
    staleTime: 5 * 60 * 1000,
  });

  const milestone = currentMilestone(count);
  if (!milestone) return null;

  const accented = hasPerk(count, 'profile_accent');
  const framed = hasPerk(count, 'profile_frame');

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        framed
          ? 'bg-primary text-primary-foreground'
          : accented
            ? 'bg-primary/15 text-primary'
            : 'bg-muted text-muted-foreground',
        className,
      )}
      title={`${count} ${count === 1 ? 'friend' : 'friends'} joined Afiyeat through them`}
    >
      <Stamp className="h-3 w-3" />
      {milestone.name}
    </span>
  );
}

/**
 * Whether this person's count earns the profile frame perk (Ambassador and
 * above), for the avatar ring. Shares PassportBadge's cached query.
 */
export function usePassportFrame(userId: string | undefined): boolean {
  const { data: count = 0 } = useQuery({
    queryKey: ['passport-referral-count', userId],
    queryFn: () => fetchQualifiedReferralCount(userId!),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
  return hasPerk(count, 'profile_frame');
}
