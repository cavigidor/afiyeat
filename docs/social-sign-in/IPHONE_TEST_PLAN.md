# Social sign-in: physical iPhone test plan

For the branch `feat/social-sign-in`. Run it after every item in OWNER_SETUP.md sections A–C is done.

## Before you start

- Rotate the Afiyeat password before using real accounts (PM decision 2026-11-20).
- Build the separate test app on the Mac. It installs **next to** the RC3 build and does not replace it:
  ```
  bash scripts/trial/prepare-social-auth-trial.sh <full commit id>
  ```
  - Add `--apple-browser` if the backend's Apple Client ID can't include `com.afiyeat.app.authtest`.
  - The test app uses the **production backend**, because that's where sign-in is configured. Every account it creates is real.
- **Accounts you need:**
  - **E1:** an existing email account with lists, photos, followers and a referral code. Note its profile link (Profile › share → `/u/<id>`) and Passport code **before** testing.
  - **G-new:** a Google account that has never used Afiyeat.
  - **G-same:** the Gmail address that E1 uses, if E1 is a Gmail.
  - **G-other:** a second Google account that is not E1's address.
  - **A-new:** an Apple Account that has never used Afiyeat with this app. If it has, reset it on the iPhone: Settings › [your name] › Sign in with Apple › Afiyeat › Stop Using.
- Afterwards: delete the test accounts (Profile › Delete account), then delete the test app.

For each check, record pass or fail, plus a screenshot if it fails.

## A. New accounts

| # | Steps | Expected |
|---|---|---|
| A1 | Sign Up tab › **Sign up with Apple** › Share My Email › Face ID | Apple's native sheet (or the browser sheet with `--apple-browser`). Then **Finish setting up your account**, showing "Signed in with Apple as you@…". Display name prefilled from Apple. |
| A2 | On A1's screen tap Continue without the checkbox, then with username `ab` | Both errors shown; nothing saved. |
| A3 | Enter a username that already exists, tick Terms, Continue | "This username is already taken". |
| A4 | Tap **Terms of Service**, then come back | The Terms page opens; Back returns to setup. |
| A5 | Valid username, tick, Continue | "Welcome to Afiyeat!", then the app. Profile shows the username. Profile › Sign-in methods: Apple Connected. |
| A6 | Delete A5's account, sign up again with Apple › **Hide My Email** | Setup shows a `…@privaterelay.appleid.com` address and no username suggestion. |
| A7 | Sign In tab › **Continue with Google** (G-new) | The system browser sheet (title shows supabase.co) with Google's account chooser. Then setup, with username and display name suggested from Google. |
| A8 | At setup, force-quit the app and reopen | Still signed in; setup shows again. Finish it, then the app. |
| A9 | From another phone or account, share an invite link (`afiyeat.com/invite/…`). Open it on the iPhone in the **real** app if installed, otherwise in Safari, then sign up with Google (G-other) in the test app | After setup: "X invited you". The referral appears in the inviter's Passport. (Universal links open the real app, not the test app, so A9 is best done once on TestFlight.) |

## B. Existing accounts (data must be kept)

| # | Steps | Expected |
|---|---|---|
| B1 | Signed out › **Continue with Google** with G-same (E1's Gmail) | Lands **directly in E1**, with no setup screen. Same `/u/<id>`, lists, recipes, photos, followers, Passport code. Profile › Sign-in methods: Email ✓, Google ✓. |
| B2 | E1 with a real (non-relay) email: **Sign in with Apple** › Share My Email with the same address | Same as B1: E1 with all data; Apple ✓. |
| B3 | Apple **Hide My Email** with an Apple ID whose email differs from E1 | Setup screen for a new empty account. Tap **Already have an Afiyeat account?** › **Remove it and sign in another way**. Back at Sign In with a message. |
| B4 | Continue B3: sign in to E1 with email and password › Profile › Sign-in methods › Apple **Connect** | Apple sheet, then "Apple is now connected". Sign out, then Sign in with Apple opens **E1**. (If it says "isn't switched on yet", manual linking is off: OWNER_SETUP C4.) |
| B5 | In E1: Sign-in methods › Google **Connect** with G-other | "Google is now connected". Sign out, Continue with Google (G-other) opens **E1**. |
| B6 | Try to Connect a Google or Apple account that already belongs to another Afiyeat account | "…already used by a different Afiyeat account…". You stay signed in to E1. |
| B7 | Email + password sign in, Forgot password (code), and email Sign Up with OTP | All work exactly as before. |

## C. Cancel and errors

| # | Steps | Expected |
|---|---|---|
| C1 | Sign in with Apple › swipe the sheet down or tap Cancel | Back on Sign In; no error message; buttons enabled. |
| C2 | Continue with Google › **Cancel** (top-left of the sheet) | Same as C1. |
| C3 | Continue with Google › on Google's page choose Cancel | Back on Sign In, with no message or a short one. Never signed in. |
| C4 | Airplane mode › Continue with Google | "Couldn't reach the server. Check your connection…". |
| C5 | During the Google sheet, press Home and wait 30 s, then come back | The sheet is still there and completes normally. |
| C6 | Tap Apple, then quickly tap Google | The second tap is ignored; only one sheet opens. |
| C7 | iPhone signed out of its Apple Account (only if convenient) › Sign in with Apple | Message to check you're signed in to your Apple Account. |

## D. Session, reopen and logout

| # | Steps | Expected |
|---|---|---|
| D1 | Signed in with Google › force-quit › reopen | Straight into the app; no setup screen, no long spinner. |
| D2 | Airplane mode › reopen a signed-in Apple account | Opens the app (setup isn't re-asked offline). |
| D3 | Profile › Sign out › Continue with Google | Google shows the **account chooser**, so another account can be picked. |
| D4 | Sign out, then check that no sign-in screen data from the old account appears | Normal sign-in screen. |
| D5 | Delete an Apple test account (Profile › Delete account) | Returns to sign-in; signing in again with Apple makes a **new** account with setup. Known gap: Afiyeat stays under Settings › Sign in with Apple until token revocation is built (OWNER_SETUP "Still required"). |

## E. Website (after Lovable publishes the merged branch to afiyeat.com)

| # | Steps | Expected |
|---|---|---|
| E1 | Safari on Mac and iPhone: afiyeat.com/auth › Continue with Google | Google page; back on afiyeat.com briefly via `/auth-callback.html` then `/auth/callback`; signed in. The address bar ends without any `code=`. |
| E2 | Same with Sign in with Apple (unless `VITE_APPLE_SIGN_IN_WEB=off`) | Apple web sign-in; signed in. |
| E3 | Cancel on Google's or Apple's page | Back to /auth; not signed in. |
| E4 | Signed in to E1 on the web › Profile › Connect Google › Cancel | Back to Profile, **still signed in**. |
| E5 | Reload /auth/callback after a sign-in | "That sign-in took too long…" with "Back to sign in"; nothing else happens. |
| E6 | On iPhone Safari, sign in on afiyeat.com while the Afiyeat app is installed | Stays in Safari; the app is not opened. |
