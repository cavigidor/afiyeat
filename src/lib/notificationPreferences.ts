import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

/**
 * Consent for the three daily engagement pushes.
 *
 * App Review Guideline 4.5.4: push notifications used for promotions or
 * direct marketing need an explicit opt-in via consent language shown in the
 * app, plus an in-app way to opt out. These three pushes count as such, so:
 *  - they are OFF for everyone until the person turns them on in
 *    Profile > Notifications, where DAILY_PUSH_CONSENT_TEXT is shown;
 *  - allowing notifications in Apple's dialog does NOT turn them on;
 *  - existing accounts start with nothing turned on.
 * The server enforces this: the scheduled senders only send a push to users
 * with a row in notification_consents for it (migration
 * 20261118120000_good_morning_fun_facts_and_city_explore.sql). Social
 * notifications (follows, shared lists) aren't covered by this.
 */
export const DAILY_PUSHES = [
  {
    kind: 'good_morning_fun_fact',
    time: '7 AM',
    title: 'Good morning fun fact',
    description: 'A fact about animals, the world, nature or space',
  },
  {
    kind: 'morning_explore',
    time: '8 AM',
    title: 'Explore your city',
    description: 'One idea for somewhere new to see today',
  },
  {
    kind: 'evening_explore',
    time: '5 PM',
    title: 'Evening exploring',
    description: 'Somewhere to discover this evening: views, markets, cafés, music',
  },
] as const;

export type DailyPushKind = (typeof DAILY_PUSHES)[number]['kind'];
export const ALL_DAILY_PUSH_KINDS: DailyPushKind[] = DAILY_PUSHES.map((p) => p.kind);

/** Shown next to the opt-in switch. Change CONSENT_VERSION whenever this
 *  wording changes, so each stored consent records what the person saw. */
export const DAILY_PUSH_CONSENT_TEXT =
  'Yes, send me up to three Afiyeat notifications a day: a good-morning fun fact at 7 AM and ideas for ' +
  'exploring my city at 8 AM and 5 PM, in my time zone. You can turn these off here at any time.';
export const DAILY_PUSH_CONSENT_VERSION = '2026-11-18';

export type DailyPushConsents =
  | { status: 'ok'; consented: DailyPushKind[] }
  // The database doesn't have the notification update yet. The settings
  // card hides itself rather than showing switches that can't save.
  | { status: 'unavailable' };

// notification_consents isn't in the generated Supabase types until the
// migration is applied and the types are regenerated, so use an untyped
// client for just this table.
const consents = () => (supabase as unknown as SupabaseClient).from('notification_consents');

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return (
    error.code === '42P01' || // undefined_table (Postgres)
    error.code === 'PGRST205' || // table not in PostgREST's schema cache
    /notification_consents/.test(error.message ?? '')
  );
}

export async function fetchDailyPushConsents(userId: string): Promise<DailyPushConsents> {
  const { data, error } = await consents().select('push_kind').eq('user_id', userId);
  if (error) {
    if (isMissingTable(error)) return { status: 'unavailable' };
    throw error;
  }
  const known = new Set<string>(ALL_DAILY_PUSH_KINDS);
  return {
    status: 'ok',
    consented: (data ?? [])
      .map((row: { push_kind: string }) => row.push_kind)
      .filter((k): k is DailyPushKind => known.has(k)),
  };
}

/** Gives (on) or withdraws (off) consent for the given pushes. */
export async function setDailyPushConsent(userId: string, kinds: DailyPushKind[], on: boolean): Promise<void> {
  if (kinds.length === 0) return;
  const { error } = on
    ? await consents().upsert(
        kinds.map((kind) => ({ user_id: userId, push_kind: kind, consent_version: DAILY_PUSH_CONSENT_VERSION })),
        { onConflict: 'user_id,push_kind', ignoreDuplicates: true },
      )
    : await consents().delete().eq('user_id', userId).in('push_kind', kinds);
  if (error) throw error;
}
