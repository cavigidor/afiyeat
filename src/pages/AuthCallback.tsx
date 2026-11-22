import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { postAuthDestination } from '@/lib/passport';
import { completeWebCallback } from '@/lib/socialAuth/socialAuth';
import { friendlyAuthError, isCancellation, type PendingFlow } from '@/lib/socialAuth/callback';
import { PROVIDER_LABEL } from '@/lib/socialAuth/config';

/**
 * Finishes a Sign in with Apple / Continue with Google started on the
 * website (see lib/socialAuth). Runs once; a reload or Back finds nothing
 * left to replay and offers the way back instead.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const started = useRef(false);
  const [failure, setFailure] = useState<{ message: string; intent: PendingFlow['intent'] } | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const pending = await completeWebCallback();
        if (pending.intent === 'link') {
          toast.success(`${PROVIDER_LABEL[pending.provider]} is now connected to your account`);
          navigate('/profile', { replace: true });
        } else {
          navigate(postAuthDestination(), { replace: true });
        }
      } catch (error) {
        const pending = (error as { pending?: PendingFlow | null }).pending ?? null;
        const intent = pending?.intent ?? 'signin';
        if (isCancellation(error)) {
          navigate(intent === 'link' ? '/profile' : '/auth', { replace: true });
          return;
        }
        setFailure({ message: friendlyAuthError(error, pending?.provider ?? 'google'), intent });
      }
    })();
  }, [navigate]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 text-center space-y-4">
          {failure ? (
            <>
              <p className="text-sm text-foreground" role="alert">{failure.message}</p>
              <Button
                className="w-full"
                onClick={() => navigate(failure.intent === 'link' ? '/profile' : '/auth', { replace: true })}
              >
                {failure.intent === 'link' ? 'Back to Profile' : 'Back to sign in'}
              </Button>
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 py-6" aria-live="polite">
              <Spinner className="h-6 w-6" label="Signing you in" />
              <p className="text-sm text-muted-foreground">Signing you in…</p>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
