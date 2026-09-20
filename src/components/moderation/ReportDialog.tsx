import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Flag } from 'lucide-react';
import { toast } from 'sonner';
import {
  REPORT_REASONS,
  submitReport,
  type ReportReason,
  type ReportableContentType,
} from '@/lib/moderation';

interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportedUserId: string;
  /** What's being reported. Defaults to the account itself. */
  contentType?: ReportableContentType;
  contentId?: string;
  /** Shown in the dialog so it's unambiguous what's being reported. */
  subjectLabel?: string;
}

export function ReportDialog({
  open,
  onOpenChange,
  reportedUserId,
  contentType = 'user',
  contentId,
  subjectLabel,
}: ReportDialogProps) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setReason(null);
    setDescription('');
    setSubmitting(false);
  };

  const handleSubmit = async () => {
    if (!reason) return;
    setSubmitting(true);
    const result = await submitReport({
      reportedUserId,
      reason,
      description,
      contentType,
      contentId,
    });
    setSubmitting(false);

    if (result.ok) {
      // Deliberately doesn't promise an outcome or a timeline - it says
      // what happened and stops. Over-promising on moderation is worse
      // than saying little.
      toast.success('Report sent', {
        description: 'Thanks for flagging this. Our team will take a look.',
      });
      onOpenChange(false);
      reset();
      return;
    }
    if (result.reason === 'duplicate') {
      toast.info(result.message);
      onOpenChange(false);
      reset();
      return;
    }
    toast.error(result.message);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-4 w-4" />
            Report {subjectLabel ? <span className="truncate">{subjectLabel}</span> : 'this'}
          </DialogTitle>
          <DialogDescription>
            Tell us what's wrong. Reports are private — the person you're reporting won't be told
            who reported them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {REPORT_REASONS.map((option) => {
            const selected = reason === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setReason(option.value)}
                aria-pressed={selected}
                className={`active-press w-full rounded-lg border p-3 text-left transition-[background-color,border-color] duration-150 ease-out ${
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-background active:bg-muted/60'
                }`}
              >
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground mt-0.5">{option.hint}</span>
              </button>
            );
          })}
        </div>

        {reason && (
          <div className="space-y-2">
            <Textarea
              placeholder={
                reason === 'other'
                  ? 'Please tell us what\'s wrong (required)'
                  : 'Add any detail that would help (optional)'
              }
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
            />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            // 'Other' carries no meaning on its own, so it needs the
            // free-text field before a moderator can act on it.
            disabled={!reason || submitting || (reason === 'other' && !description.trim())}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send report
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
