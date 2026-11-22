# Social sign-in: backend changes for approval

Draft PR branch `backend/social-sign-in-account-safety`, based on `main` @ `94e8099`. It pairs with the app PR #26 (`feat/social-sign-in`).

**Nothing here is applied, deployed or configured.** Lovable deploys Edge Functions from `main`, so merging this PR deploys `delete-account`. Merge only after the approvals below.

## What it changes

### 1. `delete-account` Edge Function

The function is split into three files:

- `index.ts`: Deno wiring only.
- `handler.ts`: the request handling.
- `apple.ts`: Apple's REST calls.

The existing deletion steps (auth user, then the rows the cascade can't reach, then image files) are moved unchanged into `handler.ts`.

**Behaviour for every account without an Apple identity is unchanged**, including the current app's call with no body. That covers the App Store build, RC3 and the website today. Two things are added.

**a. Sign in with Apple revocation** (App Review guideline 5.1.1(v), Apple TN3194)

- Afiyeat never stores Apple tokens. When an account with an Apple identity is deleted, the app asks the person to confirm with Apple once more and sends the fresh single-use `authorization_code`, the client id and a one-time nonce.
- The function then does four things, **before deleting anything**:
  1. Signs a 5-minute client secret (ES256, `.p8` key).
  2. Exchanges the code at `appleid.apple.com/auth/token`.
  3. Checks the identity token: issuer, audience = client id, nonce, and **subject = this account's Apple identity**.
  4. Revokes the refresh token at `/auth/revoke`, falling back to the access token if there's no refresh token.
- If anything fails, **nothing is deleted** and the app is told why:
  - `apple_reauth_required` (409)
  - `apple_reauth_failed` (400)
  - `apple_identity_mismatch` (400)
  - `apple_request_invalid` (400)
  - `apple_revoke_failed` (502)
  - `apple_not_configured` (503)
- The person can then try again, or choose **delete anyway**: `continue_without_apple_revocation: true`. TN3194 says deletion must still be honoured without tokens. The app then tells them to remove Afiyeat under their Apple Account's Sign in with Apple settings.
- If revocation succeeds but the deletion itself fails, the account is intact and can be retried.
- Client ids and website redirect URIs are allow-listed in the function's secrets.
- Tokens and the key are never logged or returned.

**Capabilities probe.** A request with the header `x-afiyeat-probe: capabilities` returns `{capabilities: [...]}` without a session and touches nothing. The previous function answers that request (sent with the publishable key) with 401 without deleting anything, so the app never sends a discard request to a function that would ignore the safeguard.

**b. `mode: "discard_new_account"`** (the setup screen's "Already have an Afiyeat account?")

- Refuses unless `public.social_account_discard_check` (part 2) says the account is a brand-new, untouched Apple/Google account. It is checked before any Apple call **and again immediately before deleting**.
- Refusal is `409 account_not_discardable` with reasons.
- If the SQL isn't applied, the reply is `503 discard_check_unavailable` and nothing is deleted.

### 2. SQL proposal: `db/proposals/social_sign_in/`

Deliberately not in `supabase/migrations`. Files: `social_sign_in_account_safety.sql` plus `_precheck`, `_postcheck` and `_rollback`. It adds four things and changes no existing table, policy, trigger or function.

- **`public.terms_acceptances`**: a server-side record that an Apple/Google account accepted the Terms and Privacy Policy.
  - Columns: version dates, `method = 'account_setup'`, and `accepted_at` set by the server.
  - Access: RLS on; accounts can SELECT their own rows; no one but `service_role` can insert, change or delete.
  - Deleted with the account (`ON DELETE CASCADE`).
- **`public.complete_account_setup(username, display_name, terms_version, privacy_version)`**: SECURITY DEFINER, `authenticated` only.
  - In one transaction it saves the username and display name (limits 3–20 and ≤50) and records acceptance.
  - It only accepts the **current** versions (`2026-10-07`), which are fixed in the function.
  - A taken username (`23505`) rolls the whole call back.
  - Replaces the app's earlier write to auth `user_metadata`, which the account itself could edit.
- **`public.social_sign_in_ready()`**: returns `'v1'` and can be called signed out. The app shows Apple/Google buttons only when a provider is enabled **and** this answers. So enabling a provider before this SQL is applied can't strand new accounts.
- **`public.social_account_discard_check(user_id)`**: SECURITY DEFINER, `service_role` only. It refuses if any of these is true:
  - The account wasn't created by Apple or Google.
  - It's older than 7 days.
  - It has more than one identity, or any email identity.
  - It has a username, display name or bio.
  - It has accepted the Terms.
  - Its seeded folders were changed.
  - **Any row in any public table with a foreign key to `auth.users`** points at it (found generically, so future tables are covered). Device tokens are the exception.
  - A row in the user columns that have no foreign key: `recipes`, `cellar_items`, `shared_lists`, `shared_list_items`, `shared_list_item_comments`, `moderation_*`.
  - It has an uploaded file.

## Required approvals and secrets (owner / PM)

1. **SQL.** Back up first, then follow the same pattern as the Lists V2 runbook:
   - Run `social_sign_in_account_safety_precheck.sql`: 10 rows, all `ok = true`.
   - Apply `social_sign_in_account_safety.sql` as one transaction (Lovable's runner).
   - Run `social_sign_in_account_safety_postcheck.sql`: 9 rows, all `ok = true`.
   - Rollback (`_rollback.sql`) refuses while any acceptance exists, unless a backup is confirmed in the session.
2. **Edge Function secrets** (Lovable Cloud › Secrets; never in the repo or chat):

   | Secret | Value |
   |---|---|
   | `APPLE_TEAM_ID` | `A7V4PN4DWK` |
   | `APPLE_KEY_ID` | Key ID of the Sign in with Apple key |
   | `APPLE_PRIVATE_KEY` | Full contents of that `.p8`. Line breaks or `\n` are both accepted. |
   | `APPLE_CLIENT_IDS` | `com.afiyeat.app,com.afiyeat.web`, plus `,com.afiyeat.app.authtest` while testing |
   | `APPLE_WEB_REDIRECT_URIS` | `https://afiyeat.com/auth-callback.html,https://www.afiyeat.com/auth-callback.html` |

   - The key must have Sign in with Apple enabled, with primary App ID `com.afiyeat.app`. It can be the same key used to generate the backend's Apple client secret.
   - The website redirect URIs must also be listed as Return URLs on the Services ID.
3. **Order:**
   1. SQL.
   2. Secrets.
   3. Merge/deploy this PR.
   4. Then the provider settings in OWNER_SETUP.md, and only then the app PR #26.
   - Until step 3, the deployed function is the old one: it ignores the new request body and deletes **without** revoking Apple. So do not enable Apple sign-in before step 3.

## Verification done (no live systems)

- **PGlite:** 16/16 tests, run with every migration in `supabase/migrations` on `main` replayed, as in RC3's harness.
  - Precheck, apply as one transaction, postcheck.
  - Acceptance records: server timestamp, idempotent retry, taken username records nothing, old versions, bad usernames, signed-out callers.
  - RLS on the acceptance records: own rows only; no insert, update or delete by accounts.
  - Cascade on account deletion.
  - Readiness probe.
  - Discard check: allowed for a fresh Apple or Google account; refused for each reason above, including follows, referrals, recipes and storage files.
  - Rollback guard.
- **Node:** 26/26 tests for `apple.ts` and `handler.ts`, with a real ES256 key generated in the test and a fake Apple.
  - Revoke-before-delete order.
  - Nothing deleted on any Apple failure.
  - Delete-anyway path.
  - Subject, nonce, audience and issuer checks.
  - Allow-listed client ids.
  - Discard re-check before delete.
  - No tokens in logs.
  - Unchanged no-body behaviour.
- **Repo checks:**
  - `deno check` and `deno lint` pass for `apple.ts` and `handler.ts` (Deno 2.9.6).
  - `index.ts` imports from deno.land/esm.sh, which can't be downloaded in this environment, so it was not type-checked.
  - Repo typecheck 0, lint 0 errors, build OK.
- **Run:** `npm i --no-save vitest@3.2.7 @electric-sql/pglite@0.5.13 && npx vitest run --config tests/socialSignInBackend.vitest.config.ts`

## Not verified (needs live Apple and backend)

- A real `/auth/token` + `/auth/revoke` round trip.
- Apple's exact behaviour when a token issued to one client id in the App ID group is revoked. Apple's forums leave this open. The app re-authorises on the same platform it deletes from, so the client id always matches the code.
