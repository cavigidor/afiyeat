import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { SharedListDetail } from '@/components/shared/SharedListDetail';
import { useAuth } from '@/contexts/AuthContext';
import { useGoBack } from '@/hooks/useGoBack';
import { SHARED_LISTS_PATH } from '@/lib/navigation';

/**
 * /my-lists/shared/:listId - one shared list, under Lists (the Lists tab
 * stays selected). Reached from Lists -> Shared, Activity, and converting
 * a custom list into a shared one. Back returns to wherever you came from,
 * or to Lists -> Shared when the list was opened directly.
 */
export default function SharedListDetailPage() {
  const { listId } = useParams<{ listId: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const goBack = useGoBack(SHARED_LISTS_PATH);

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [user, authLoading, navigate]);

  if (authLoading || !user || !listId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container py-4 sm:py-8 px-4 sm:px-6 lg:px-8 space-y-4 sm:space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={goBack}>
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back
        </Button>
        {/* Keyed so moving from one shared list to another starts fresh. */}
        <SharedListDetail
          key={listId}
          listId={listId}
          onDeleted={() => navigate(SHARED_LISTS_PATH, { replace: true })}
        />
      </main>
    </div>
  );
}
