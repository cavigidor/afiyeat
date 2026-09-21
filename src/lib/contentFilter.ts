/**
 * A first-pass filter for obviously objectionable text at publish time.
 *
 * This is deliberately modest and should not be mistaken for moderation.
 * A word list cannot understand context, catches none of the harm that
 * matters most (targeted harassment reads as perfectly ordinary words),
 * and produces false positives on legitimate food writing. What it does
 * is stop the laziest slur-spam from ever landing in the database, and
 * give App Review a concrete answer to "what filtering happens at
 * publish?".
 *
 * The real safety net is the report/block system plus a human working the
 * queue. The shape here - a single checkText() that returns a verdict -
 * is chosen so a hosted text-classification service can be swapped in
 * behind it later without touching any call site.
 */

export type ContentVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

// Slurs and unambiguous sexual-explicit terms only. Deliberately excludes
// ordinary profanity: someone calling a burrito "fucking incredible" is
// writing a restaurant review, not abusing anyone, and blocking that
// would make the app feel censorious while catching no actual harm.
const BLOCKED_PATTERNS: RegExp[] = [
  /\bn[i1]gg[e3]r(s)?\b/i,
  /\bf[a4]gg?[o0]t(s)?\b/i,
  /\bk[i1]k[e3](s)?\b/i,
  /\bch[i1]nk(s)?\b/i,
  /\btr[a4]nn(y|ies)\b/i,
  /\br[e3]t[a4]rd(ed|s)?\b/i,
  /\bcunt(s)?\b/i,
  /\bchild\s*p[o0]rn\b/i,
  /\bcp\s*(links?|trade)\b/i,
];

// Crude spam heuristics - the pattern that actually shows up in a food
// app is a comment that is mostly a URL plus a call to action.
const SPAM_PATTERNS: RegExp[] = [
  /\b(?:https?:\/\/\S+\s*){3,}/i, // three or more links in one field
  /\b(?:whats\s*app|telegram|wechat)\b.{0,20}\+?\d{7,}/i, // contact-me spam
];

/**
 * Checks a piece of user-authored text before it is stored.
 *
 * Returns a verdict rather than throwing or auto-sanitising, so callers
 * decide what to do - a hard block on a public list name, say, versus a
 * softer warning elsewhere. Never silently rewrites the user's words.
 */
export function checkText(input: string | null | undefined): ContentVerdict {
  if (!input) return { allowed: true };

  // Normalise a few common evasions (zero-width characters, repeated
  // separators) before matching. This is a speed bump, not a defence -
  // anyone determined will get past it, and the report queue is what
  // actually handles them.
  const normalised = input
    .replace(/[​-‍﻿]/g, '')
    .replace(/[._\-*]+/g, '');

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(normalised)) {
      return {
        allowed: false,
        reason: 'This contains language we don\'t allow on Afiyeat.',
      };
    }
  }

  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(input)) {
      return {
        allowed: false,
        reason: 'This looks like spam. Try removing links or contact details.',
      };
    }
  }

  return { allowed: true };
}

/**
 * Convenience for forms with several user-authored fields: returns the
 * first failing verdict, or allowed.
 */
export function checkTextFields(...fields: (string | null | undefined)[]): ContentVerdict {
  for (const field of fields) {
    const verdict = checkText(field);
    if (!verdict.allowed) return verdict;
  }
  return { allowed: true };
}
