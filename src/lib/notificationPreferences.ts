import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

/**
 * The three daily pushes and the user's per-push opt-outs.
 *
 * The pushes themselves are sent by the database on a schedule (migration
 * 20261118120000_good_morning_fun_facts_and_city_explore.sql), at 7am, 8am
 * and 5pm in the timezone saved on the user's profile. A row in
 * notification_opt_outs switches one of them off for that user; no row
 * means on. Social notifications (follows, shared lists) aren't covered
 * here.
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

export type DailyPushOptOuts =
  | { status: 'ok'; optedOut: DailyPushKind[] }
  // The database doesn't have the notification update yet. The settings
  // card hides itself rather than showing switches that can't save.
  | { status: 'unavailable' };

// notification_opt_outs isn't in the generated Supabase types until the
// migration is applied and the types are regenerated, so use an untyped
// client for just this table.
const optOuts = () => (supabase as unknown as SupabaseClient).from('notification_opt_outs');

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return (
    error.code === '42P01' || // undefined_table (Postgres)
    error.code === 'PGRST205' || // table not in PostgREST's schema cache
    /notification_opt_outs/.test(error.message ?? '')
  );
}

export async function fetchDailyPushOptOuts(userId: string): Promise<DailyPushOptOuts> {
  const { data, error } = await optOuts().select('push_kind').eq('user_id', userId);
  if (error) {
    if (isMissingTable(error)) return { status: 'unavailable' };
    throw error;
  }
  const known = new Set<string>(DAILY_PUSHES.map((p) => p.kind));
  return {
    status: 'ok',
    optedOut: (data ?? [])
      .map((row: { push_kind: string }) => row.push_kind)
      .filter((k): k is DailyPushKind => known.has(k)),
  };
}

export async function setDailyPushEnabled(userId: string, kind: DailyPushKind, enabled: boolean): Promise<void> {
  const { error } = enabled
    ? await optOuts().delete().eq('user_id', userId).eq('push_kind', kind)
    : await optOuts().upsert(
        { user_id: userId, push_kind: kind },
        { onConflict: 'user_id,push_kind', ignoreDuplicates: true },
      );
  if (error) throw error;
}
