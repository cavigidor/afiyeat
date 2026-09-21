import { supabase } from '@/integrations/supabase/client';
import { SITE_URL } from '@/lib/site';

/**
 * Afiyeat Passport - referral codes, milestones and invite links.
 *
 * Every rule that decides whether a referral counts lives in the database
 * (see the 20260920140000 migration). This module reads and presents;
 * it cannot award anything, which is the point - the client is not
 * trusted with reward logic.
 */

// ---------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------

export interface Milestone {
  threshold: number;
  id: string;
  name: string;
  blurb: string;
  /** Feature flags unlocked at this level, checked via hasPerk(). */
  perks: string[];
}

/**
 * The single place milestone numbers and rewards are defined. Changing a
 * threshold here changes the badge, the progress bar and the perk checks
 * together - nothing else hardcodes these numbers.
 *
 * Perks are deliberately cosmetic or additive (badges, accents, early
 * access). None of them removes or gates functionality that a user who
 * never invites anyone would otherwise have: a referral programme that
 * degrades the app for non-participants is a worse app with a growth
 * feature bolted on.
 */
export const MILESTONES: Milestone[] = [
  {
    threshold: 1,
    id: 'table_for_two',
    name: 'Table for Two',
    blurb: 'Your first friend joined you on Afiyeat.',
    perks: ['badge_table_for_two'],
  },
  {
    threshold: 3,
    id: 'local_foodie',
    name: 'Local Foodie',
    blurb: 'Three friends are building their food maps because of you.',
    perks: ['badge_local_foodie', 'profile_accent'],
  },
  {
    threshold: 5,
    id: 'insider',
    name: 'Afiyeat Insider',
    blurb: 'Five friends in. You get early access to new features.',
    perks: ['badge_insider', 'profile_accent', 'early_access'],
  },
  {
    threshold: 10,
    id: 'ambassador',
    name: 'Afiyeat Ambassador',
    blurb: 'Ten friends. Permanent Ambassador status on your profile.',
    perks: ['badge_ambassador', 'profile_frame', 'profile_accent', 'early_access'],
  },
  {
    threshold: 25,
    id: 'founding_foodie',
    name: 'Founding Foodie',
    blurb: 'The highest launch-era recognition on Afiyeat.',
    perks: [
      'badge_founding_foodie',
      'profile_frame',
      'profile_accent',
      'early_access',
      'founding_status',
    ],
  },
];

/** The highest milestone reached at this count, or null below the first. */
export function currentMilestone(qualifiedCount: number): Milestone | null {
  let reached: Milestone | null = null;
  for (const milestone of MILESTONES) {
    if (qualifiedCount >= milestone.threshold) reached = milestone;
  }
  return reached;
}

/** The next milestone to aim for, or null once they're all reached. */
export function nextMilestone(qualifiedCount: number): Milestone | null {
  return MILESTONES.find((m) => qualifiedCount < m.threshold) ?? null;
}

/** Whether a given perk is unlocked at this count. */
export function hasPerk(qualifiedCount: number, perk: string): boolean {
  const milestone = currentMilestone(qualifiedCount);
  return milestone ? milestone.perks.includes(perk) : false;
}

// ---------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------

export interface PassportSummary {
  referralCode: string | null;
  qualifiedCount: number;
  pendingCount: number;
  stampCount: number;
}

export async function fetchPassportSummary(): Promise<PassportSummary> {
  const { data, error } = await supabase.rpc('get_passport_summary');
  if (error || !data || typeof data !== 'object' || !('ok' in data) || !data.ok) {
    if (error) console.error('fetchPassportSummary failed:', error);
    return { referralCode: null, qualifiedCount: 0, pendingCount: 0, stampCount: 0 };
  }
  const row = data as Record<string, unknown>;
  return {
    referralCode: (row.referral_code as string) ?? null,
    qualifiedCount: Number(row.qualified_count ?? 0),
    pendingCount: Number(row.pending_count ?? 0),
    stampCount: Number(row.stamp_count ?? 0),
  };
}

// ---------------------------------------------------------------------
// Links and attribution
// ---------------------------------------------------------------------

/** Where a referral link was tapped, for attribution analytics. */
export type ReferralSource =
  | 'invite_link'
  | 'restaurant'
  | 'custom_list'
  | 'recipe'
  | 'profile'
  | 'shared_list'
  | 'other';

/** The plain invite link, for the Passport screen's Copy/Share buttons. */
export function inviteUrl(code: string): string {
  return `${SITE_URL}/invite/${code}`;
}

/**
 * Adds referral attribution to a content URL.
 *
 * Content links stay content links - the recipient lands on the actual
 * recipe or list, and the referral rides along as a query parameter. That
 * ordering matters: a link that dumps someone on a signup wall when we
 * know exactly which dish they were sent is a worse experience and a
 * worse conversion rate. The content does the selling.
 */
export function withReferral(url: string, code: string | null, source: ReferralSource): string {
  if (!code) return url;
  const parsed = new URL(url, SITE_URL);
  parsed.searchParams.set('ref', code);
  parsed.searchParams.set('ref_src', source);
  return parsed.toString();
}

const PENDING_REFERRAL_KEY = 'afiyeat.pending_referral';

export interface PendingReferral {
  code: string;
  source: ReferralSource;
  contentType?: string;
  contentId?: string;
  /** Where to send them back to after signup. */
  returnTo?: string;
}

/**
 * Remembers an invite across the signup flow.
 *
 * Someone arriving on a shared recipe has to pass through sign-up before
 * we know who they are, so the code is parked here and claimed once they
 * have an account. Stored rather than passed through the URL so it
 * survives the email-verification round trip.
 */
export function storePendingReferral(pending: PendingReferral): void {
  try {
    localStorage.setItem(PENDING_REFERRAL_KEY, JSON.stringify(pending));
  } catch {
    // Private browsing or a full quota - referral attribution is not
    // worth breaking signup over.
  }
}

export function readPendingReferral(): PendingReferral | null {
  try {
    const raw = localStorage.getItem(PENDING_REFERRAL_KEY);
    return raw ? (JSON.parse(raw) as PendingReferral) : null;
  } catch {
    return null;
  }
}

export function clearPendingReferral(): void {
  try {
    localStorage.removeItem(PENDING_REFERRAL_KEY);
  } catch {
    /* nothing to clean up */
  }
}

/**
 * Claims a parked referral for the freshly created account.
 *
 * All the validation - unknown code, self-referral, already referred,
 * account too old - happens in the database. This reports the outcome and
 * always clears the parked code, since a rejected claim should not be
 * retried on every subsequent launch.
 */
export async function claimPendingReferral(): Promise<
  { claimed: true; referrerId: string } | { claimed: false; reason: string }
> {
  const pending = readPendingReferral();
  if (!pending) return { claimed: false, reason: 'none' };

  const { data, error } = await supabase.rpc('claim_referral', {
    p_code: pending.code,
    p_source: pending.source,
    p_content_type: pending.contentType ?? null,
    p_content_id: pending.contentId ?? null,
  });

  clearPendingReferral();

  if (error || !data || typeof data !== 'object') {
    if (error) console.error('claimPendingReferral failed:', error);
    return { claimed: false, reason: 'error' };
  }
  const row = data as Record<string, unknown>;
  if (!row.ok) return { claimed: false, reason: String(row.reason ?? 'rejected') };
  return { claimed: true, referrerId: String(row.referrer_id) };
}
