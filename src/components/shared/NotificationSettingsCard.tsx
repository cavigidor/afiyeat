import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/contexts/AuthContext';
import { getPushPermission, isNative } from '@/lib/native';
import { askForPushPermissionFromSettings, openIPhoneSettings, syncPushRegistration } from '@/lib/pushPermission';
import {
  ALL_DAILY_PUSH_KINDS,
  DAILY_PUSHES,
  DAILY_PUSH_CONSENT_TEXT,
  fetchDailyPushConsents,
  setDailyPushConsent,
  type DailyPushConsents,
  type DailyPushKind,
} from '@/lib/notificationPreferences';

/**
 * Profile > Notifications.
 *
 *  - This iPhone's permission: if it's off, how to turn it on in iPhone
 *    Settings (Apple's dialog can't be shown twice).
 *  - The daily engagement pushes: off until the person opts in here, next to
 *    the consent wording (App Review 4.5.4), then one switch per push.
 *    Stored on the account, so it applies on every device they use.
 *
 * Hidden entirely until the database has the notification update (see
 * lib/notificationPreferences.ts).
 */
export function NotificationSettingsCard() {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const queryKey = ['daily-push-consents', userId];

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchDailyPushConsents(userId!),
    enabled: !!userId,
    staleTime: 60 * 1000,
  });

  const { data: permission, refetch: refetchPermission } = useQuery({
    queryKey: ['push-permission'],
    queryFn: getPushPermission,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  if (!userId || data?.status === 'unavailable') return null;

  const consented = data?.status === 'ok' ? data.consented : [];
  const optedIn = consented.length > 0;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const save = async (kinds: DailyPushKind[], on: boolean) => {
    const previous = queryClient.getQueryData<DailyPushConsents>(queryKey);
    const next = on ? [...new Set([...consented, ...kinds])] : consented.filter((k) => !kinds.includes(k));
    queryClient.setQueryData<DailyPushConsents>(queryKey, { status: 'ok', consented: next });
    try {
      await setDailyPushConsent(userId, kinds, on);
    } catch {
      queryClient.setQueryData(queryKey, previous);
      toast.error("Couldn't save that. Check your connection and try again.");
    }
  };

  const allowOnThisIPhone = async () => {
    await askForPushPermissionFromSettings();
    await syncPushRegistration(userId);
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
      <CardContent className="space-y-4">
        {permission === 'denied' && (
          <div className="space-y-2 rounded-lg bg-muted p-3">
            <p className="text-sm font-medium">Notifications are off for Afiyeat on this iPhone</p>
            <p className="text-xs text-muted-foreground">
              Nothing from Afiyeat can arrive until you allow it in iPhone Settings › Notifications › Afiyeat.
            </p>
            <Button size="sm" variant="outline" onClick={openIPhoneSettings}>
              Open iPhone Settings
            </Button>
          </div>
        )}
        {permission === 'not-asked' && (
          <div className="space-y-2 rounded-lg bg-muted p-3">
            <p className="text-sm font-medium">Notifications aren't allowed on this iPhone yet</p>
            <Button size="sm" onClick={() => void allowOnThisIPhone()}>
              Allow notifications
            </Button>
          </div>
        )}

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
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <label htmlFor="daily-push-opt-in" className="min-w-0 space-y-1">
                <span className="block text-sm font-medium">Daily ideas</span>
                <span className="block text-xs text-muted-foreground">{DAILY_PUSH_CONSENT_TEXT}</span>
              </label>
              <Switch
                id="daily-push-opt-in"
                className="mt-0.5 shrink-0"
                checked={optedIn}
                onCheckedChange={(on) => void save(ALL_DAILY_PUSH_KINDS, on)}
              />
            </div>

            {optedIn && (
              <div className="space-y-2 pl-3">
                {DAILY_PUSHES.map((push) => {
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
                        className="shrink-0"
                        checked={consented.includes(push.kind)}
                        onCheckedChange={(on) => void save([push.kind], on)}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {optedIn && permission === 'denied' && (
              <p className="text-xs text-muted-foreground">
                These are saved, but won't arrive until notifications are allowed in iPhone Settings.
              </p>
            )}
            {optedIn && !isNative() && <p className="text-xs text-muted-foreground">These arrive on the iPhone app.</p>}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {timeZone ? `Times follow your time zone (${timeZone}). ` : ''}
          Notifications about follows and shared lists aren't affected by these switches.
        </p>
      </CardContent>
    </Card>
  );
}
