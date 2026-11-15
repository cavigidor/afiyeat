# Security draft: list-ownership check on status and category writes

**Status: proposal for PM review. Not approved. Not applied anywhere. No deployment is authorized.**
Independent of Lists V2: branched from `main`, depends on no Lists V2 branch, and works whether or not production
has the integration stack. Nothing here is in `supabase/migrations/`.

## The gap (verified in-process; production unverified)

On `main` and on the integration stack, INSERT and UPDATE policies on `custom_list_statuses` and
`custom_list_types` check only `auth.uid() = user_id`. A signed-in user can add a status or category to someone
else's list (or move their own row onto it), and the owner's app shows it. PR #7 closed the same gap for
`custom_list_items` only.

Verified here, by `npm test` (5 tests, PGlite, on main alone and on main + stack `eea7a96`): the gap exists; the fix
closes insert and move for both tables; the owner can still create, rename, reorder and delete; nothing except the
four named policies changes; the fix runs twice safely; it stops with no change if an extra permissive write
policy exists; `rollback.sql` restores main's policies exactly.

Not verified: production's live policies (read-only `e0/security/owner-check-verification.sql` V1/V6 on PR #16),
behaviour through the real API with two accounts (`e0/security/owner-check.isolated.mjs`), and old app builds.

## Files

| File | Purpose |
| --- | --- |
| `fix.sql` | One transaction: precondition check, then replaces four policies by name |
| `rollback.sql` | Restores main's four definitions exactly (re-opens the gap) |
| `postcheck.sql` | Read-only: the complete permissive policy set per table and write command |
| `anomaly-diagnostics.sql` | Read-only, counts only: O-S1 anomalies (tested) |
| `tests/owner-policy.test.mjs` | The tests above |
| `harness/` | Self-contained copy of the replay harness (repairs and Supabase stand-ins) |

## Deployment plan (for when, and only if, the PM authorizes it)

1. **Read-only evidence first:** V0–V6 in production by a separately authorized Lovable operator. If V1 differs
   from main's definitions, stop: `fix.sql`'s precondition would refuse anyway, and the rollback has to be
   rewritten from production's saved V1 text.
2. **Isolated project:** apply `fix.sql`; run `owner-check.isolated.mjs --expect gap` before and `--expect fixed`
   after; run the old-client check: the current App Store build and the stack build create a list, add, rename,
   reorder and delete statuses and categories, against the isolated project. Signed-out, follower, stranger and
   blocked accounts are checked for unchanged reads.
3. **Production:** only through a normal reviewed migration that the PM authorizes, never as a canary merged to
   main. Run `postcheck.sql` right after; keep `rollback.sql` and the saved V1 output to hand.
4. **Existing rows:** nothing is deleted or changed. V4 counts are integrity anomalies to be investigated, not
   proof that anyone exploited the gap.

## PM decisions (2026-11-15)

* **O-S2:** an independent security workstream. Not merged or deployed until production's actual policies are verified
  (V0–V6) and the isolated two-account tests pass (`--expect gap` before, `--expect fixed` after).
* **O-S1:** existing cross-owner rows are preserved. Nothing is deleted or reassigned automatically.

## Legitimate editing is preserved (verified)

Every app write to these tables targets the signed-in user's own list. Checked in the code at the stack tip:
`CreateListDialog` seeds statuses for the list it just created; `useListStatusManagement` and
`useListTypeManagement` (add, rename, reorder, delete) run only on `CustomListDetail`, which loads the list with
`.eq('user_id', userId)`; `PublicListDetail` only reads. The tests exercise create, rename, reorder and delete as the
owner on main alone and on main + stack. Not verified locally: old app builds and the real API (isolated-project gate).

## O-S1: diagnostics and non-destructive reconciliation plan

`anomaly-diagnostics.sql` (read-only, counts only) reports per table: anomalous rows, lists and owners affected,
distinct row owners, rows referenced by items, rows used by the list owner's own items, rows whose writer's account is
gone, and the first and last creation time. Tested: correct counts, no ids or names in the result, identical before
and after `fix.sql`, and `fix.sql` deletes or reassigns nothing.

Plan, each step needing its own approval:

1. **Measure:** the operator runs `anomaly-diagnostics.sql` and V4/V5. If every count is zero, stop here.
2. **Explain before acting:** a counts-only result cannot tell a bug from misuse. If non-zero, the PM decides whether an
   admin may read row ids (not content) to correlate them with app releases and account history.
3. **Preserve:** the fix changes no rows. The list owner keeps seeing and using these statuses and categories exactly as
   today, so no item loses its status.
4. **Record (proposal):** an admin-only snapshot table (`table, row id, list id, created_at`, no content) taken once, so
   later decisions refer to a fixed set. This is a hosted write and is not prepared as SQL until approved.
5. **Per-case options for the owner, later:** keep as is (default); let the list owner rename, hide or delete rows on
   their own list (needs one more policy change, reviewed separately); or a reviewed, reversible clean-up. No automatic
   path exists.

Known effect of the fix on these rows: their original writer can no longer update them, but can still delete them
under the existing DELETE policy; the list owner cannot delete them. Step 5 is where that is decided.
