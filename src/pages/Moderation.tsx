import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Eye, Loader2, ShieldAlert, ShieldCheck, UserX, UserCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { Navbar } from '@/components/layout/Navbar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { useAuth } from '@/contexts/AuthContext';
import {
  REPORT_REASONS,
  decideReport,
  fetchIsModerator,
  fetchModerationReports,
  type ModerationAction,
  type ModerationFilter,
  type ModerationReport,
} from '@/lib/moderation';

const ACTION_COPY: Record<ModerationAction, { title: string; body: string; confirm: string }> = {
  dismiss: {
    title: 'Dismiss this report?',
    body: "Nothing wrong found. The report closes; if the content was hidden automatically and nothing else is open against it, it's shown again.",
    confirm: 'Dismiss',
  },
  hide: {
    title: 'Hide this content?',
    body: 'It disappears for everyone except its author. Every open report about it is closed.',
    confirm: 'Hide content',
  },
  unhide: {
    title: 'Show this content again?',
    body: 'It becomes visible again to the people who could see it before.',
    confirm: 'Show again',
  },
  restrict: {
    title: 'Restrict this account?',
    body: 'Everything this account has posted is hidden from everyone else, and every open report against it is closed. Use for serious or repeated abuse.',
    confirm: 'Restrict account',
  },
  unrestrict: {
    title: 'Lift the restriction?',
    body: "This account's content becomes visible again.",
    confirm: 'Lift restriction',
  },
};

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

const reasonLabel = (value: string) => REPORT_REASONS.find((r) => r.value === value)?.label ?? value;

function contentLink(r: ModerationReport): string | null {
  switch (r.content_type) {
    case 'restaurant':
      return r.content_id ? `/r/${r.content_id}` : null;
    case 'recipe':
      return r.content_id ? `/recipe/${r.content_id}` : null;
    case 'custom_list':
      return r.content_id ? `/u/${r.reported_user_id}/lists/${r.content_id}` : null;
    default:
      return `/u/${r.reported_user_id}`;
  }
}

/**
 * /moderation - the report queue, for accounts with the moderator or
 * admin role. Every action goes through moderation_decide, which checks
 * the role on the server and records an audit entry.
 */
export default function Moderation() {
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ModerationFilter>('open');
  const [pending, setPending] = useState<{ report: ModerationReport; action: ModerationAction } | null>(null);
  const [note, setNote] = useState('');
  const [working, setWorking] = useState(false);

  const { data: isModerator, isLoading: roleLoading } = useQuery({
    queryKey: ['is-moderator', user?.id],
    queryFn: fetchIsModerator,
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['moderation-reports', filter],
    queryFn: () => fetchModerationReports(filter),
    enabled: !!isModerator,
    staleTime: 15 * 1000,
  });

  if (authLoading || (user && roleLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user || !isModerator) return <Navigate to="/" replace />;

  const run = async () => {
    if (!pending) return;
    setWorking(true);
    try {
      await decideReport(pending.report.id, pending.action, note);
      toast.success('Done');
      setPending(null);
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['moderation-reports'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That didn\'t work. Please try again.');
    } finally {
      setWorking(false);
    }
  };

  const ask = (report: ModerationReport, action: ModerationAction) => {
    setNote('');
    setPending({ report, action });
  };

  const hideable = (r: ModerationReport) =>
    !!r.content_id &&
    ['restaurant', 'custom_list', 'custom_list_item', 'recipe', 'shared_list_item', 'comment'].includes(r.content_type ?? '');

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container py-4 sm:py-8 px-4 sm:px-6 max-w-3xl space-y-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Moderation</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Review new reports within 24 hours. Content reported by three different people is hidden automatically
          until you decide.
        </p>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as ModerationFilter)}>
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="closed">Closed</TabsTrigger>
          </TabsList>
        </Tabs>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : reports.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <ShieldCheck className="h-10 w-10 mx-auto mb-3 opacity-50" />
              {filter === 'open' ? 'No open reports. All clear.' : 'No closed reports yet.'}
            </CardContent>
          </Card>
        ) : (
          reports.map((r) => {
            const link = contentLink(r);
            const reported = r.reported_display_name || (r.reported_username ? `@${r.reported_username}` : 'Unknown');
            return (
              <Card key={r.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="destructive">{reasonLabel(r.reason)}</Badge>
                    <Badge variant="secondary">{(r.content_type ?? 'user').replace(/_/g, ' ')}</Badge>
                    {r.content_hidden && (
                      <Badge variant="outline" className="gap-1">
                        <EyeOff className="h-3 w-3" />
                        {r.hidden_reason === 'auto_reports' ? 'Auto-hidden' : 'Hidden'}
                      </Badge>
                    )}
                    {r.user_restricted && (
                      <Badge variant="outline" className="gap-1">
                        <UserX className="h-3 w-3" />
                        Account restricted
                      </Badge>
                    )}
                    {r.status !== 'pending' && <Badge variant="outline">{r.status}</Badge>}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {timeAgo(r.created_at)}
                    </span>
                  </div>

                  <div className="rounded-md bg-muted/50 p-3 text-sm">
                    <p className="font-medium break-words">{r.content_preview?.title || '(no title)'}</p>
                    {r.content_preview?.text && (
                      <p className="text-muted-foreground mt-1 whitespace-pre-wrap break-words line-clamp-6">
                        {r.content_preview.text}
                      </p>
                    )}
                    {!r.content_preview && <p className="text-muted-foreground mt-1">This content has been deleted.</p>}
                  </div>

                  <div className="text-sm space-y-1">
                    <p>
                      <span className="text-muted-foreground">Posted by </span>
                      <Link to={`/u/${r.reported_user_id}`} className="font-medium hover:underline">
                        {reported}
                      </Link>
                      <span className="text-muted-foreground">
                        {' '}· {r.total_reports_against_user} report{r.total_reports_against_user === 1 ? '' : 's'} against this account
                      </span>
                    </p>
                    <p className="text-muted-foreground">
                      Reported by {r.reporter_username ? `@${r.reporter_username}` : 'someone'}
                    </p>
                    {r.description && <p className="whitespace-pre-wrap break-words">"{r.description}"</p>}
                    {r.moderator_notes && (
                      <p className="text-muted-foreground">
                        <span className="font-medium">Note:</span> {r.moderator_notes}
                      </p>
                    )}
                    {link && (
                      <Link to={link} className="text-primary text-sm hover:underline">
                        View in the app
                      </Link>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {(r.status === 'pending' || r.status === 'reviewing') && (
                      <Button size="sm" variant="outline" onClick={() => ask(r, 'dismiss')}>
                        <X className="h-4 w-4 mr-1" /> Dismiss
                      </Button>
                    )}
                    {hideable(r) &&
                      (r.content_hidden ? (
                        <Button size="sm" variant="outline" onClick={() => ask(r, 'unhide')}>
                          <Eye className="h-4 w-4 mr-1" /> Show again
                        </Button>
                      ) : (
                        <Button size="sm" variant="destructive" onClick={() => ask(r, 'hide')}>
                          <EyeOff className="h-4 w-4 mr-1" /> Hide content
                        </Button>
                      ))}
                    {r.user_restricted ? (
                      <Button size="sm" variant="outline" onClick={() => ask(r, 'unrestrict')}>
                        <UserCheck className="h-4 w-4 mr-1" /> Lift restriction
                      </Button>
                    ) : (
                      <Button size="sm" variant="destructive" onClick={() => ask(r, 'restrict')}>
                        <UserX className="h-4 w-4 mr-1" /> Restrict account
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </main>

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending ? ACTION_COPY[pending.action].title : ''}</AlertDialogTitle>
            <AlertDialogDescription>{pending ? ACTION_COPY[pending.action].body : ''}</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Note for the record (optional, never shown to users)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={working}
              onClick={(e) => {
                e.preventDefault();
                void run();
              }}
            >
              {working && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {pending ? ACTION_COPY[pending.action].confirm : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
