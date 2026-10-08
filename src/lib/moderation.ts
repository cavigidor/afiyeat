import { supabase } from '@/integrations/supabase/client';

/**
 * Reporting and blocking - the user-facing half of the UGC safety system
 * (see the 20260920120000_ugc_safety_report_and_block migration for the
 * database side, which is where the rules are actually enforced).
 *
 * Everything here is a thin wrapper over the tables: the client decides
 * what to show, never what is permitted. Blocks are applied by RLS, so a
 * blocked user reading the API directly still sees nothing.
 */

/** Reasons offered in the report dialog, in the order they're shown. */
export const REPORT_REASONS = [
  { value: 'spam', label: 'Spam', hint: 'Repetitive, promotional or fake content' },
  { value: 'harassment', label: 'Harassment or bullying', hint: 'Targeted abuse or threats' },
  { value: 'hate', label: 'Hate or abusive content', hint: 'Attacks based on identity' },
  { value: 'sexual', label: 'Sexual or inappropriate', hint: 'Adult or explicit content' },
  { value: 'dangerous', label: 'Dangerous content', hint: 'Harm, illegal activity or unsafe advice' },
  { value: 'copyright', label: 'Copyright or IP', hint: 'Uses work that isn\'t theirs' },
  { value: 'other', label: 'Something else', hint: 'Tell us what\'s wrong' },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['value'];

/** The kinds of thing that can be reported. 'user' means the account itself. */
export type ReportableContentType =
  | 'user'
  | 'restaurant'
  | 'custom_list'
  | 'custom_list_item'
  | 'recipe'
  | 'shared_list'
  | 'shared_list_item'
  | 'comment'
  | 'profile_photo';

export interface SubmitReportInput {
  reportedUserId: string;
  reason: ReportReason;
  description?: string;
  contentType?: ReportableContentType;
  contentId?: string;
}

export type SubmitReportResult =
  | { ok: true }
  | { ok: false; reason: 'duplicate' | 'self' | 'error'; message: string };

/**
 * Files a report. The database rejects self-reports and duplicate open
 * reports outright, so those come back as specific results rather than a
 * generic failure - "you've already reported this" is a better answer
 * than an error toast, and stops people re-reporting in the belief that
 * the first one didn't register.
 */
export async function submitReport(input: SubmitReportInput): Promise<SubmitReportResult> {
  const { data: auth } = await supabase.auth.getUser();
  const reporterId = auth.user?.id;
  if (!reporterId) {
    return { ok: false, reason: 'error', message: 'You need to be signed in to report.' };
  }
  if (reporterId === input.reportedUserId) {
    return { ok: false, reason: 'self', message: 'You can\'t report yourself.' };
  }

  const { data: created, error } = await supabase
    .from('content_reports')
    .insert({
      reporter_id: reporterId,
      reported_user_id: input.reportedUserId,
      reason: input.reason,
      description: input.description?.trim() || null,
      content_type: input.contentType ?? 'user',
      content_id: input.contentId ?? null,
    })
    .select('id')
    .single();

  if (error) {
    // 23505 = unique_violation, which here can only be the partial index
    // preventing a second open report of the same target by the same
    // person. 23514 = check_violation, i.e. the self-report constraint.
    if (error.code === '23505') {
      return {
        ok: false,
        reason: 'duplicate',
        message: 'You\'ve already reported this. We\'re looking into it.',
      };
    }
    if (error.code === '23514') {
      return { ok: false, reason: 'self', message: 'You can\'t report yourself.' };
    }
    console.error('submitReport failed:', error);
    return { ok: false, reason: 'error', message: 'Couldn\'t send that report. Please try again.' };
  }

  // Email the moderator straight away. Fire-and-forget: the report is
  // already saved, and it also shows in the moderation queue regardless.
  if (created?.id) {
    void supabase.functions
      .invoke('report-alert', { body: { reportId: created.id } })
      .catch((err) => console.error('report-alert failed:', err));
  }

  return { ok: true };
}

/**
 * Blocks a user. The database trigger also severs any follow relationship
 * in both directions, so this immediately revokes whatever follower-level
 * access to private content either side had.
 */
export async function blockUser(blockedId: string): Promise<{ ok: boolean; message?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const blockerId = auth.user?.id;
  if (!blockerId) return { ok: false, message: 'You need to be signed in.' };
  if (blockerId === blockedId) return { ok: false, message: 'You can\'t block yourself.' };

  const { error } = await supabase
    .from('blocked_users')
    .insert({ blocker_id: blockerId, blocked_id: blockedId });

  // Already blocked is the outcome the user wanted, not a failure.
  if (error && error.code !== '23505') {
    console.error('blockUser failed:', error);
    return { ok: false, message: 'Couldn\'t block this person. Please try again.' };
  }
  return { ok: true };
}

export async function unblockUser(blockedId: string): Promise<{ ok: boolean; message?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const blockerId = auth.user?.id;
  if (!blockerId) return { ok: false, message: 'You need to be signed in.' };

  const { error } = await supabase
    .from('blocked_users')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);

  if (error) {
    console.error('unblockUser failed:', error);
    return { ok: false, message: 'Couldn\'t unblock this person. Please try again.' };
  }
  return { ok: true };
}

/** Whether the signed-in user has blocked this person. */
export async function hasBlocked(otherUserId: string): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  const blockerId = auth.user?.id;
  if (!blockerId) return false;

  const { data } = await supabase
    .from('blocked_users')
    .select('id')
    .eq('blocker_id', blockerId)
    .eq('blocked_id', otherUserId)
    .maybeSingle();

  return !!data;
}

/** The signed-in user's block list, for the settings screen. */
export async function fetchBlockedUsers() {
  const { data: auth } = await supabase.auth.getUser();
  const blockerId = auth.user?.id;
  if (!blockerId) return [];

  const { data: blocks } = await supabase
    .from('blocked_users')
    .select('blocked_id, created_at')
    .eq('blocker_id', blockerId)
    .order('created_at', { ascending: false });

  if (!blocks?.length) return [];

  // Profiles are fetched separately rather than via an embed: the
  // restrictive block policy hides blocked users' profile rows from this
  // very query, so an inner join would return nothing. Reading them by id
  // with the same restriction in place means display_name/username come
  // back empty, which the UI renders as "Blocked user" - deliberately, so
  // the list is still manageable without re-exposing someone you blocked.
  const ids = blocks.map((b) => b.blocked_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, display_name, username, avatar_emoji, avatar_color')
    .in('user_id', ids);

  const byId = new Map((profiles ?? []).map((p) => [p.user_id, p]));
  return blocks.map((b) => ({
    userId: b.blocked_id,
    blockedAt: b.created_at,
    profile: byId.get(b.blocked_id) ?? null,
  }));
}

// ---------------------------------------------------------------------
// Moderator tools (see migration 20261010120000_moderation_enforcement)
// ---------------------------------------------------------------------

// The moderation functions are called by name rather than through the
// generated types, which Lovable regenerates after each migration.
const moderationRpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;

export async function fetchIsModerator(): Promise<boolean> {
  const { data, error } = await moderationRpc('is_moderator');
  if (error) return false;
  return data === true;
}

export type ModerationAction = 'dismiss' | 'hide' | 'unhide' | 'restrict' | 'unrestrict';
export type ModerationFilter = 'open' | 'closed';

export interface ModerationReport {
  id: string;
  created_at: string;
  status: 'pending' | 'reviewing' | 'actioned' | 'dismissed';
  reason: ReportReason;
  description: string | null;
  content_type: ReportableContentType | null;
  content_id: string | null;
  moderator_notes: string | null;
  reviewed_at: string | null;
  reporter_id: string;
  reporter_username: string | null;
  reported_user_id: string;
  reported_username: string | null;
  reported_display_name: string | null;
  total_reports_against_user: number;
  content_hidden: boolean;
  hidden_reason: 'auto_reports' | 'moderator' | null;
  user_restricted: boolean;
  content_preview: { title: string | null; text: string | null } | null;
}

export async function fetchModerationReports(filter: ModerationFilter): Promise<ModerationReport[]> {
  const { data, error } = await moderationRpc('moderation_list_reports', { p_status: filter, p_limit: 200 });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data as ModerationReport[]) : [];
}

export async function decideReport(reportId: string, action: ModerationAction, note?: string): Promise<void> {
  const { error } = await moderationRpc('moderation_decide', {
    p_report_id: reportId,
    p_action: action,
    p_note: note?.trim() || null,
  });
  if (error) throw new Error(error.message);
}
