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
import { ScanLine } from 'lucide-react';

// Bump the version if what happens to a scanned photo changes (a different
// AI provider, for example), so everyone is asked again.
const CONSENT_KEY = 'afiyeat_ai_scan_consent_v1';

export function hasScanConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'yes';
  } catch {
    return false;
  }
}

function saveScanConsent(): void {
  try {
    localStorage.setItem(CONSENT_KEY, 'yes');
  } catch {
    // Storage unavailable (private mode): they'll simply be asked again.
  }
}

interface ScanConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called from the button's own click, so it may open the photo picker. */
  onContinue: () => void;
  onTypeInstead: () => void;
}

/**
 * Asked once before the first photo scan. Apple's guideline 5.1.2(i)
 * requires telling people, and getting their permission, before personal
 * data such as a photo is shared with a third-party AI service.
 */
export function ScanConsentDialog({ open, onOpenChange, onContinue, onTypeInstead }: ScanConsentDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto sm:mx-0 mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <ScanLine className="h-5 w-5 text-primary" />
          </div>
          <AlertDialogTitle>Scan with AI</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                To read your recipe, the photo you choose is sent to Google's Gemini AI, through
                our AI provider Lovable. Afiyeat doesn't keep the photo, only the recipe text you
                save.
              </p>
              <p>Please don't scan photos that show people or personal details.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onTypeInstead}>Type it in instead</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              saveScanConsent();
              onContinue();
            }}
          >
            Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
