# CP1 pre-merge stabilization

Scope: PR #7's universal Add Item, based on `889f58f` and targeting
`home-navigation`. No CP2–CP5 changes, production writes, migration application,
merge, or deployment are part of this checkpoint.

## Save behavior

- Custom-list Add waits for a successful, nonempty status response. Loading,
  fetch failure, failed background refresh, and an empty status configuration
  block saving. Retrieval failure offers Retry without clearing the draft.
- The default is the first status in the destination's own order. A status
  selected on another list cannot be carried into this list's save.
- The dialog cannot be dismissed while a save is active, preventing an earlier
  completion from closing a newly opened draft.
- Once the item insert succeeds, the item stays saved even if photos fail.
  Both storage errors and attachment-record errors, including rejected network
  requests, count as attachment failures. Other photos are still attempted.
- `SaveResult` includes the saved ID and uploaded/failed photo counts. The
  universal dialog and existing restaurant/custom-list dialogs show a warning
  instead of full success when attachments are incomplete. Retry photos through
  the saved item's edit flow; do not submit the item again. No automatic retries
  or deletion of saved items occur. A blob whose metadata write fails may remain
  unattached; storage cleanup and uncertain network outcomes need live-backend
  verification before any retry/cleanup feature is introduced.

## Independently executed checks

Install with `npm ci`, then run:

```sh
npm test
npm run typecheck
npm run build
npm run lint
```

- 38 tests pass: 8 Add Item component tests, 14 attachment/save tests, and 16
  PostgreSQL ownership-policy tests.
- The component tests use React Testing Library/jsdom with simulated retrieval
  and save responses. The attachment tests exercise the real save helpers with
  simulated Supabase storage and database responses.
- Four targeted regressions (delayed statuses, failed status retrieval, and
  partial storage failure for each destination) were also executed against
  original `889f58f`: all four fail there and pass with this stabilization.
- Typecheck includes the new tests/config and passes. Production build passes;
  existing Browserslist-age and bundle-size warnings remain.
- Lint retains the baseline **1 error / 22 warnings**. The error is
  `src/integrations/supabase/previewAuthStorage.ts:38` (`prefer-const`). Main's
  `9baf34e` already excludes the generated files. This checkpoint does not edit
  generated code or change lint rules.
- These results do not reproduce or certify the earlier author-reported
  42/42 CP1 or 61/61 navigation browser suites.

## Ownership-policy review

`tests/customListOwnership.test.ts` reconstructs policies from **all repository
migrations preceding the owner-check migration**, honoring drops and collapsing
repeated canonical/Lovable-generated definitions by table and policy name.
It uses the actual policy bodies and block/moderation helper functions in PGlite
PostgreSQL with fixture table shapes/authentication plumbing. It is not a full
Supabase installation or a snapshot of the live database.

The resulting `custom_list_items` policy set has eight policies:

| Policy | Operation | Effect |
| --- | --- | --- |
| Users can view their own custom list items | SELECT | Permissive |
| Users can view custom list items of public profiles | SELECT | Permissive |
| Users can view custom list items of people they follow | SELECT | Permissive |
| Users can insert their own custom list items | INSERT | Permissive; replaced by CP1 |
| Users can update their own custom list items | UPDATE | Permissive; replaced by CP1 |
| Users can delete their own custom list items | DELETE | Permissive |
| Blocked users cannot view custom list items | SELECT | Restrictive |
| Hidden list items are not shown | SELECT | Restrictive |

No additional permissive INSERT, UPDATE, or ALL policy appears in the
reconstructed catalog. The INSERT check requires both `auth.uid() = user_id`
and an owned destination list. UPDATE's USING limits eligible existing rows to
the caller's items; WITH CHECK enforces caller identity and destination
ownership on the new row. Public/follower SELECT access does not grant writes.
Own insert/edit/delete and moves between owned lists remain permitted. Block and
moderation restrictions still apply. Shared-list policies are untouched.

The migration is policy-only and re-runnable. Existing owner/list mismatches are
not repaired or deleted. A mismatched row cannot be edited while left in a
foreign list; moving the caller's own row back to their own list is allowed.

**Live policy verification is still outstanding.** A read-only `pg_policies`
request to Afiyeat project `dmlkjpjubneqhbqoxlct` was denied by the connected
Supabase account. Neither the live policy inventory nor deployment state can be
certified from this review. The migration file is unchanged and unapplied by
this checkpoint.

## Recommended migration deployment procedure

1. Obtain authorized access to the correct Afiyeat environment. Save a policy
   catalog snapshot and confirm RLS is enabled. Run the following read-only
   queries with sufficient privileges to see all relevant rows:

   ```sql
   SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
   FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('custom_lists', 'custom_list_items')
   ORDER BY tablename, policyname;

   SELECT relname, relrowsecurity, relforcerowsecurity
   FROM pg_class
   WHERE oid IN ('public.custom_lists'::regclass, 'public.custom_list_items'::regclass);

   SELECT count(*) AS ownership_mismatches
   FROM public.custom_list_items i
   JOIN public.custom_lists l ON l.id = i.list_id
   WHERE i.user_id <> l.user_id;
   ```

2. Compare the live catalog with the inventory above. An extra permissive INSERT,
   UPDATE, or ALL policy can bypass the intended restriction; investigate before
   proceeding. A nonzero mismatch count requires a separate data-repair decision,
   not automatic deletion. A normal signed-in RLS query can undercount.
3. Validate the exact migration in a staging environment using two real accounts:
   own CRUD and own-to-own moves succeed; foreign-list insert/move and forged
   ownership fail. Test with ordinary authenticated access, not a service role
   that bypasses RLS. Preserve public/follower reads, blocks and moderation.
4. Only during a separately authorized deployment, apply the exact
   `20261029120000_custom_list_items_owner_check.sql` through the established
   Lovable/Supabase migration workflow, with migration-history tracking and a
   transaction around its DROP/CREATE statements. This frontend commit does not
   prove that workflow ran. If validation fails before commit, roll back the
   transaction; do not automatically restore the vulnerable policies.
5. Inspect the resulting live policies, record the applied migration/version,
   and repeat the account-based tests. Confirm existing row counts/mismatches
   were not changed and current clients can still save. Keep the security task
   open until these live checks pass.

## Incorporating CP1 after PR #1's squash merge

Do not merge CP1 into `home-navigation` to bypass PR #1's acceptance gate.
After PR #1 is approved and squash-merged, fetch the resulting main and inspect
PR #7's comparison. A squash does not preserve the original navigation commits
as ancestors, so changing the PR base alone can include PR #1 changes again.

Prefer a **new branch from updated main**. List and review the commits in
`9a50224..origin/lists-add-item`, then cherry-pick only CP1 commits in order:
the original `889f58f` plus this stabilization and any subsequently reviewed CP1
fixes. Do not cherry-pick PR #1's navigation commits. Resolve conflicts without
reintroducing old navigation or overwriting main's generated-file lint fix.
Confirm `git diff origin/main...HEAD` contains only CP1, rerun all checks, and
push that new branch normally for a replacement PR if needed. Keep PR #7 as the
review reference until the replacement is agreed; no force-push is necessary.
Neither a new remote branch nor a replacement PR is created by this checkpoint.

## Remaining backend and physical-iPhone acceptance

- With normal accounts, save to My Restaurants, custom lists and an eligible
  shared list; confirm the partner sees the shared save and all list counts
  refresh correctly.
- Throttle status retrieval and cause a real retrieval failure: Add stays
  blocked, Retry preserves the draft, and the saved item has a valid status.
- Verify actual Apple place search and resolving saved locations.
- Upload real photos; simulate storage failure and attachment-record failure.
  Confirm the item and successful photos persist, the warning is accurate, and
  reattaching through Edit does not duplicate the item. Inspect any unattached
  blobs before deciding how to clean them up.
- On a small and a notched physical iPhone, test the native keyboard, scrolling,
  bottom Add button, safe areas, Retry message, warning/View action and camera.
- Complete PR #1's existing navigation/iPhone acceptance separately. Re-run the
  CP1 checks after replaying onto the squash-merged main. No completion claim is
  made for these device/backend steps.
