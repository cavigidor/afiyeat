import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, EyeOff, Flag } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ReportDialog } from '@/components/moderation/ReportDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useGoBack } from '@/hooks/useGoBack';
import { fetchDiscoverableList, reportDiscoverableList } from '@/lib/communityLists';
import { DiscoverableListView } from '@/components/lists/DiscoverableListView';
import type { SubmitReportResult } from '@/lib/moderation';

export default function DiscoverableListPage() {
  const { token } = useParams<{ token: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const goBack = useGoBack('/explore?c=lists');
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [user, authLoading, navigate]);

  const { data: list, isLoading, isError, refetch } = useQuery({
    queryKey: ['discoverable-list', token],
    queryFn: () => fetchDiscoverableList(token!),
    enabled: !!user && !!token,
    // Re-check on every visit: the owner can withdraw a list at any time.
    staleTime: 0,
  });

  const submitReport = async (reason: string, description: string): Promise<SubmitReportResult> => {
    try {
      const result = await reportDiscoverableList(token!, reason, description);
      if (result === 'reported') return { ok: true };
      if (result === 'already_reported') return { ok: false, reason: 'duplicate', message: "You've already reported this list." };
      if (result === 'own_list') return { ok: false, reason: 'self', message: "This is your list." };
      return { ok: false, reason: 'error', message: "This list isn't available any more." };
    } catch {
      return { ok: false, reason: 'error', message: "Couldn't send the report. Please try again." };
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container max-w-2xl py-4 sm:py-8 px-4 sm:px-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={goBack}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back
          </Button>
          {list && !list.is_owner && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setReportOpen(true)}>
              <Flag className="h-4 w-4 mr-1.5" />
              Report
            </Button>
          )}
        </div>

        {authLoading || isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="rounded-xl bg-card px-6 py-12 text-center">
            <p className="mb-3 text-muted-foreground">Couldn't load this list.</p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        ) : !list ? (
          <div className="rounded-xl bg-card px-6 py-16 text-center">
            <EyeOff className="mx-auto mb-4 h-10 w-10 text-muted-foreground/50" />
            <h1 className="mb-2 text-lg font-medium">This list isn't available</h1>
            <p className="text-muted-foreground">Its owner may have made it private, or it was removed.</p>
          </div>
        ) : (
          <>
            {list.is_owner && (
              <p className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
                This is your list, exactly as other people see it. Change who can see it from the list's settings.
              </p>
            )}
            <DiscoverableListView list={list} />
          </>
        )}
      </main>

      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        subjectLabel="this list"
        submit={(reason, description) => submitReport(reason, description)}
      />
    </div>
  );
}
