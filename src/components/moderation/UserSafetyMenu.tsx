import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, Flag, Ban, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { ReportDialog } from './ReportDialog';
import { blockUser, hasBlocked, unblockUser, type ReportableContentType } from '@/lib/moderation';

interface UserSafetyMenuProps {
  /** The user being reported/blocked. */
  userId: string;
  /** Display name, used in confirmation copy. */
  displayName?: string | null;
  contentType?: ReportableContentType;
  contentId?: string;
  /** Called after a successful block, so the host screen can navigate away. */
  onBlocked?: () => void;
}

/**
 * The "..." menu carrying Report and Block for a given user.
 *
 * Dropped onto any screen showing someone else's content. App Review
 * expects both actions to be reachable from the content itself rather
 * than buried in settings, and users expect them in this exact spot.
 */
export function UserSafetyMenu({
  userId,
  displayName,
  contentType = 'user',
  contentId,
  onBlocked,
}: UserSafetyMenuProps) {
  const [reportOpen, setReportOpen] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const queryClient = useQueryClient();

  const { data: blocked = false } = useQuery({
    queryKey: ['has-blocked', userId],
    queryFn: () => hasBlocked(userId),
    staleTime: 60 * 1000,
  });

  const who = displayName?.trim() || 'this person';

  const handleBlock = async () => {
    setWorking(true);
    const result = await blockUser(userId);
    setWorking(false);
    if (!result.ok) {
      toast.error(result.message ?? 'Couldn\'t block this person.');
      return;
    }
    // Blocking severs follows on both sides in the database, so anything
    // showing follower state or this person's content is now stale.
    void queryClient.invalidateQueries({ queryKey: ['has-blocked', userId] });
    void queryClient.invalidateQueries();
    toast.success(`Blocked ${who}`);
    setBlockConfirmOpen(false);
    onBlocked?.();
  };

  const handleUnblock = async () => {
    setWorking(true);
    const result = await unblockUser(userId);
    setWorking(false);
    if (!result.ok) {
      toast.error(result.message ?? 'Couldn\'t unblock this person.');
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ['has-blocked', userId] });
    void queryClient.invalidateQueries();
    toast.success(`Unblocked ${who}`);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Safety options" className="h-9 w-9">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setReportOpen(true)}>
            <Flag className="mr-2 h-4 w-4" />
            Report
          </DropdownMenuItem>
          {blocked ? (
            <DropdownMenuItem onClick={handleUnblock} disabled={working}>
              <UserCheck className="mr-2 h-4 w-4" />
              Unblock
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() => setBlockConfirmOpen(true)}
              className="text-destructive"
            >
              <Ban className="mr-2 h-4 w-4" />
              Block
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        reportedUserId={userId}
        contentType={contentType}
        contentId={contentId}
        subjectLabel={displayName ?? undefined}
      />

      <AlertDialog open={blockConfirmOpen} onOpenChange={setBlockConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block {who}?</AlertDialogTitle>
            <AlertDialogDescription>
              You won't see each other's restaurants, lists or recipes, and you'll both stop
              following each other. They won't be told you blocked them. You can undo this any time
              from Profile → Blocked accounts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Keep the dialog up while the request is in flight so the
                // button can show its disabled state instead of the sheet
                // vanishing before anything has happened.
                e.preventDefault();
                void handleBlock();
              }}
              disabled={working}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Block
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
