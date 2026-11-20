/**
 * What to write to `visited_at` when an existing place is edited.
 *
 * The visit date records when a place became "Been There". Edit dialogs used
 * to write `visited_at = now` on every save of a Been There place, so fixing
 * a typo in the notes silently replaced the real visit date with today's.
 *
 * - still Been There  -> leave visited_at out of the update (keeps the original,
 *                        including an original null on older rows)
 * - becomes Been There -> now
 * - To Go              -> null
 *
 * Returns an object to spread into the update, so "leave it out" really
 * leaves the column untouched rather than writing it back.
 */
export function visitedAtForEdit(
  previousStatus: string | null | undefined,
  nextStatus: string,
  now: Date = new Date(),
): { visited_at?: string | null } {
  if (nextStatus !== 'went_to') return { visited_at: null };
  if (previousStatus === 'went_to') return {};
  return { visited_at: now.toISOString() };
}
