import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/contexts/AuthContext';
import { getPushPermission } from '@/lib/native';
import { PUSH_PROMPT_ENABLED } from '@/lib/pushPrompt';
import { registerForPush } from '@/components/shared/PushNotificationManager';
import {
  DAILY_PUSHES,
  fetchDailyPushOptOuts,
  setDailyPushEnabled,
  type DailyPushKind,
  type DailyPushOptOuts,
} from '@/lib/notificationPreferences';

/**
 * Profile > Notifications: switch each of the three daily pushes on or off.
 *
 * iPhone Settings can only turn every notification from the app on or off
 * at once. This lets someone keep, say, the morning fun fact and drop the
 * exploration nudges. Hidden entirely until the database has the
 * notification update (see lib/notificationPreferences.ts).
 */
export function NotificationSettingsCard() {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const queryKey = ['daily-push-opt-outs', userId];

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchDailyPushOptOuts(userId!),
    enabled: !!userId,
    staleTime: 60 * 1000,
  });

  const { data: permission, refetch: refetchPermission } = useQuery({
    queryKey: ['push-permission'],
    queryFn: getPushPermission,
    staleTime: 0,
  });

  if (!userId || data?.status === 'unavailable') return null;

  const optedOut = data?.status === 'ok' ? data.optedOut : [];
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const handleToggle = async (kind: DailyPushKind, enabled: boolean) => {
    const previous = queryClient.getQueryData<DailyPushOptOuts>(queryKey);
    queryClient.setQueryData<DailyPushOptOuts>(queryKey, {
      status: 'ok',
      optedOut: enabled ? optedOut.filter((k) => k !== kind) : [...optedOut, kind],
    });
    try {
      await setDailyPushEnabled(userId, kind, enabled);
    } catch {
      queryClient.setQueryData(queryKey, previous);
      toast.error("Couldn't save that. Check your connection and try again.");
    }
  };

  const handleTurnOn = async () => {
    await registerForPush({ prompt: true });
    void refetchPermission();
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Bell className="h-4 w-4" />
          Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {permission === 'denied' && (
          <p className="text-sm text-muted-foreground rounded-lg bg-muted p-3">
            Notifications are off for Afiyeat in your iPhone Settings, so none of these will arrive. To get them, go
            to Settings › Notifications › Afiyeat.
          </p>
        )}
        {permission === 'not-asked' &&
          (PUSH_PROMPT_ENABLED ? (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
              <p className="text-sm text-muted-foreground">Notifications aren't on for this iPhone yet.</p>
              <Button size="sm" onClick={handleTurnOn}>
                Turn on
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground rounded-lg bg-muted p-3">
              Notifications aren't on for this iPhone yet.
            </p>
          ))}

        {isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Couldn't load your notification settings.</p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          DAILY_PUSHES.map((push) => {
            const id = `daily-push-${push.kind}`;
            return (
              <div key={push.kind} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <label htmlFor={id} className="min-w-0 space-y-0.5">
                  <span className="block text-sm font-medium">{push.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">{push.time}</span> · {push.description}
                  </span>
                </label>
                <Switch
                  id={id}
                  checked={!optedOut.includes(push.kind)}
                  onCheckedChange={(checked) => void handleToggle(push.kind, checked)}
                />
              </div>
            );
          })
        )}

        {timeZone && <p className="text-xs text-muted-foreground">Times follow your time zone ({timeZone}).</p>}
      </CardContent>
    </Card>
  );
}
