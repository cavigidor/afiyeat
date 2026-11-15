# Security draft: list-ownership check on status and category writes

**Status: proposal for PM review. Not approved. Not applied anywhere. No deployment is authorized.**
Independent of Lists V2: branched from `main`, depends on no Lists V2 branch, and works whether or not production
has the integration stack. Nothing here is in `supabase/migrations/`.

## The gap (verified in-process; production unverified)

On `main` and on the integration stack, INSERT and UPDATE policies on `custom_list_statuses` and
`custom_list_types` check only `auth.uid() = user_id`. A signed-in user can add a status or category to someone
else's list (or move their own row onto it), and the owner's app shows it. PR #7 closed the same gap for
`custom_list_items` only.

Verified here, by `npm test` (4 tests, PGlite, on main alone and on main + stack `eea7a96`): the gap exists; the fix
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

## Owner decisions open

* **O-S1** Rows another user already attached to someone's list stay in place. After the fix their writer cannot
  update them; under the current DELETE policy their writer can still delete them and the list owner cannot.
  Options: leave as is; let the list owner delete statuses/categories on their own list (one more policy change);
  or a reviewed clean-up. None is proposed here without the production counts.
* **O-S2** Ship this independently of Lists V2 (recommended: it is a fix on its own) or together with the
  integration stack.
