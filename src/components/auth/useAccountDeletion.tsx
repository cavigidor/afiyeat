import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { deleteMyAccount, type AppleProblem, type DeletionMode } from '@/lib/accountDeletion';

const PROBLEM_TEXT: Record<AppleProblem, string> = {
  cancelled:
    'Deleting your account also disconnects Sign in with Apple from Afiyeat. Confirm with Apple to do that now.',
  mismatch:
    "That Apple Account isn't the one connected to this Afiyeat account. Try again with the Apple Account you use for Afiyeat.",
  unavailable: "We couldn't reach Apple to disconnect Sign in with Apple from Afiyeat.",
  failed: "Confirming with Apple didn't work.",
};

const MANUAL_STEP =
  'You can still delete now. Afterwards, remove Afiyeat from the Sign in with Apple list in your Apple Account settings (on iPhone: Settings, then your name).';

/**
 * Runs an account deletion (Profile › Delete Account, or setup's "Already
 * have an Afiyeat account?") and supplies the one extra dialog it may
 * need: when Sign in with Apple couldn't be disconnected, let the person
 * try again or delete anyway. Render `dialog` once wherever the hook is used.
 */
export function useAccountDeletion(onDeleted: () => Promise<void> | void) {
  const [problem, setProblem] = useState<{ mode: DeletionMode; reason: AppleProblem } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (mode: DeletionMode, continueWithoutApple = false): Promise<boolean> => {
    setBusy(true);
    try {
      const result = await deleteMyAccount({ mode, continueWithoutApple });
      switch (result.status) {
        case 'deleted':
          setProblem(null);
          await onDeleted();
          return true;
        case 'apple_problem':
          setProblem({ mode, reason: result.reason });
          return false;
        case 'not_discardable':
          setProblem(null);
          toast.error(
            "This account already has activity, so it can't be removed here. Finish setting it up, then delete it from Profile if you don't want it.",
            { duration: 8000 },
          );
          return false;
        case 'unavailable':
          setProblem(null);
          toast.error("Removing a new sign-in isn't available yet. Please sign out instead.");
          return false;
        default:
          toast.error('Failed to delete account. Please try again.');
          return false;
      }
    } finally {
      setBusy(false);
    }
  };

  const dialog = (
    <AlertDialog open={problem !== null} onOpenChange={(open) => !open && !busy && setProblem(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect Sign in with Apple</AlertDialogTitle>
          <AlertDialogDescription>
            {problem ? PROBLEM_TEXT[problem.reason] : ''} {MANUAL_STEP}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="outline" disabled={busy} onClick={() => problem && void run(problem.mode)}>
            Confirm with Apple
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => problem && void run(problem.mode, true)}
          >
            {busy && <Spinner className="mr-2 h-4 w-4" />}
            Delete anyway
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { run, dialog, busy };
}
