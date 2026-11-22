# Social sign-in: physical iPhone test plan

For app PR #26 (`feat/social-sign-in`) together with backend PR #27.

**Don't run this yet.** It needs:

- PR #27's SQL applied, its `APPLE_*` secrets set and `delete-account` deployed;
- OWNER_SETUP.md sections A–C done.

Without the backend pieces, the app shows no Apple or Google buttons, by design.

## Before you start

- Rotate the Afiyeat password before using real accounts (PM decision 2026-11-20).
- Build the separate test app on the Mac. It installs **next to** the RC3 build and doesn't replace it:
  ```
  bash scripts/trial/prepare-social-auth-trial.sh <full commit id>
  ```
  - Add `--apple-browser` if the backend's Apple Client ID can't include `com.afiyeat.app.authtest`.
  - The test app uses the **production backend**, so every account it creates is real.
- **Apple only offers the first-time sheet once.** That's the sheet with your name and the **Share My Email / Hide My Email** choice. Later sign-ins skip it, and the email choice can't be changed, until Afiyeat's authorization is revoked (Apple TN3194). Two things revoke it:
  - **deleting the Afiyeat account in the app with "Confirm with Apple"**: PR #27 revokes it; or
  - **removing Afiyeat by hand**, using Apple's "Manage Sign in with Apple" instructions (support.apple.com/en-us/102571). On iPhone that's in Settings, under your name, in the Sign in with Apple list; the exact labels vary by iOS version. Choose **Stop Using Apple Account** for "Afiyeat Sign-in Test" / Afiyeat.

  Before every "new Apple account" test, check Afiyeat is **not** in that list.
- **Accounts you need:**
  - **E1:** an existing email account with lists, photos, followers and a referral code. Note its profile link (Profile › share → `/u/<id>`) and Passport code **before** testing.
  - **G-new:** a Google account that has never used Afiyeat.
  - **G-same:** E1's Gmail address, if E1 uses Gmail.
  - **G-other:** a second Google account whose address isn't E1's.
  - **A1:** an Apple Account not currently authorizing Afiyeat (see above).
- **Google Testing mode:** add every test Google account as a test user. A "this app is in testing" screen is expected (OWNER_SETUP B2).
- **Afterwards:**
  - Delete the test accounts in the app (Profile › Delete account), using **Confirm with Apple** for Apple ones.
  - Then delete the test app.
  - Remove `com.afiyeat.app.authtest` from the backend's Apple Client IDs and from `APPLE_CLIENT_IDS`.

For each check, record pass or fail, plus a screenshot if it fails.

## A. New accounts

| # | Steps | Expected |
|---|---|---|
| A1 | Sign Up tab › **Sign up with Apple**, using A1 › first-time sheet › **Share My Email** › Face ID | Apple's native sheet (or the browser sheet with `--apple-browser`), with name and email choice. Then **Finish setting up your account**, "Signed in with Apple as you@…", and the display name prefilled from Apple. |
| A2 | On A1's screen tap Continue without the checkbox, then with username `ab` | Both errors shown; nothing saved. |
| A3 | Enter a username that already exists, tick Terms, Continue | "This username is already taken". |
| A4 | Tap **Terms of Service**, then come back | The Terms page opens; Back returns to setup. |
| A5 | Before finishing setup: say **Allow** if asked for notifications (normally no prompt here). In Lovable Cloud's table viewer, check `device_tokens` and `profiles.timezone` for the new account. | **No** device token row; timezone empty; nothing in `terms_acceptances`. |
| A6 | Valid username, tick, Continue | "Welcome to Afiyeat!", then the app. `terms_acceptances` has one row (versions `2026-10-07`, `accepted_at` = now). The device token and timezone appear now. Profile › Sign-in methods shows Apple ✓ and the email. |
| A7 | Profile › Delete Account › type DELETE › Delete › **Apple sheet appears** › confirm | "Your account has been deleted". Afiyeat **disappears** from the Apple Account's Sign in with Apple list, and Apple may email you that it was disconnected. |
| A8 | Sign up with Apple again with A1 › this time **Hide My Email** | The **first-time sheet appears again** (because A7 revoked it). Setup shows the `…@privaterelay.appleid.com` address and no username suggestion. *If the sheet does NOT appear, A7 didn't revoke: report it.* |
| A9 | Sign In tab › **Continue with Google** (G-new) | The system browser sheet (title shows supabase.co) with Google's account chooser and a testing notice. Then setup, with username and display name suggested from Google. |
| A10 | At setup, force-quit the app and reopen | Still signed in; setup shows again; still no device token. Finish it, then the app. |
| A11 | Invite: open another account's invite link (`afiyeat.com/invite/…`), then sign up with Google (G-other) in the test app | The invite is claimed only **after** setup ("X invited you"). Universal links open the real app, not the test app, so this one is best done once on TestFlight. |

## B. Existing accounts (data must be kept)

| # | Steps | Expected |
|---|---|---|
| B1 | Signed out › **Continue with Google** with G-same (E1's Gmail) | Lands **directly in E1**, with no setup screen. Same `/u/<id>`, lists, recipes, photos, followers, Passport code. Profile › Sign-in methods: Email ✓, Google ✓. |
| B2 | E1 with a real (non-relay) email: **Sign in with Apple** › Share My Email with the same address | Same as B1: E1 with all data; Apple ✓. |
| B3 | Reset Apple for Afiyeat (see "Before you start"). **Sign in with Apple** › first-time sheet › **Hide My Email** | Setup for a **new empty** account (relay address). |
| B4 | On B3's setup screen: **Already have an Afiyeat account?** › **Remove it and sign in another way** › confirm with Apple | Back at Sign In with a message; the new account is gone; Afiyeat leaves the Apple list. |
| B5 | Sign in to E1 with email › Profile › Sign-in methods › Apple **Connect** › first-time sheet › Hide My Email | "Apple is now connected"; the relay address shows under Apple. Sign out, then Sign in with Apple opens **E1**. (If it says "isn't switched on yet", manual linking is off: OWNER_SETUP C4.) |
| B6 | In E1: Sign-in methods › Google **Connect** with G-other | "Google is now connected". Sign out, Continue with Google (G-other) opens **E1**. |
| B7 | Try to Connect a Google or Apple account that already belongs to another Afiyeat account | "…already used by a different Afiyeat account…"; still signed in to E1. |
| B8 | Email + password sign in, Forgot password (code), and email Sign Up with OTP | All work exactly as before. Deleting an **email-only** test account makes no Apple prompt. |

## C. Cancel and errors

| # | Steps | Expected |
|---|---|---|
| C1 | Sign in with Apple › swipe the sheet down or tap Cancel | Back on Sign In; no error message; buttons enabled. |
| C2 | Continue with Google › **Cancel** (top-left of the sheet) | Same as C1. |
| C3 | Continue with Google › on Google's page choose Cancel | Back on Sign In; never signed in. |
| C4 | Airplane mode › Continue with Google | "Couldn't reach the server…". |
| C5 | During the Google sheet, press Home and wait 30 s, then come back | The sheet is still there and completes. |
| C6 | Tap Apple, then quickly tap Google | Only one sheet opens. |
| C7 | Delete an Apple account › **cancel** the Apple sheet | "Disconnect Sign in with Apple" dialog: Cancel / Confirm with Apple / Delete anyway. Cancel keeps the account. |
| C8 | Same, then **Delete anyway** | Account deleted. Afiyeat **stays** in the Apple list (expected), and the dialog told you to remove it there. Remove it by hand before the next Apple test. |
| C9 | Delete an Apple account, and at the sheet use a **different** Apple Account than the one connected (if the device allows) | "That Apple Account isn't the one connected…"; nothing deleted. |

## D. Session, reopen and logout

| # | Steps | Expected |
|---|---|---|
| D1 | Signed in with Google › force-quit › reopen | Straight into the app; no setup screen, no long spinner. |
| D2 | Airplane mode › reopen a signed-in Apple account | Opens the app (setup isn't re-asked offline). |
| D3 | Profile › Sign out › Continue with Google | Google shows the **account chooser**. |
| D4 | Signed in with Apple, remove Afiyeat from the Apple Sign in with Apple list in Settings, return to the app | Signed out with "Sign in with Apple was turned off for Afiyeat…" (TN3194). |
| D5 | Signed in to an account without Apple (e.g. E1 with Google) › background and reopen several times | Never signed out by the Apple check. |

## E. Website (after Lovable publishes both merged PRs to afiyeat.com)

| # | Steps | Expected |
|---|---|---|
| E1 | Safari on Mac and iPhone: afiyeat.com/auth › Continue with Google | Google page; back via `/auth-callback.html` then `/auth/callback`; signed in; no `code=` in the address bar. |
| E2 | Same with Sign in with Apple (unless `VITE_APPLE_SIGN_IN_WEB=off`) | Apple web sign-in; signed in. |
| E3 | Cancel on Google's or Apple's page | Back to /auth; not signed in. |
| E4 | Signed in to E1 on the web › Profile › Connect Google › Cancel | Back to Profile, **still signed in**. |
| E5 | Reload /auth/callback after a sign-in | "That sign-in took too long…" with "Back to sign in". |
| E6 | iPhone Safari sign-in on afiyeat.com with the Afiyeat app installed | Stays in Safari; the app doesn't open. |
| E7 | On the web, delete an account that has Apple | Apple's popup asks to confirm; then deleted and Afiyeat leaves the Apple list. |
