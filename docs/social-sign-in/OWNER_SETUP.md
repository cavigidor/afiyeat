# Sign in with Apple and Continue with Google: owner setup

App PR #26 (`feat/social-sign-in`), with backend PR #27 (`backend/social-sign-in-account-safety`). This page lists every setting the code depends on. It contains no secrets, and none are needed in the repo.

**Never put these in the repo, a chat or a ticket:** the Apple `.p8` key, the Apple client secret (JWT) or the Google client secret. They go only into Lovable Cloud (auth settings and Edge Function secrets).

**Do the steps in this order.** The app shows no Apple or Google button until both of these are true:

- the provider is switched on in Lovable Cloud (`/auth/v1/settings`), and
- the backend SQL from PR #27 is applied (`social_sign_in_ready()` answers).

So nothing appears early, and no new account can get stuck at setup.

1. Backend PR #27: SQL, then Edge Function secrets, then deploy `delete-account`. See `BACKEND_APPROVAL.md` on that branch.
2. Sections A–C below.
3. The iPhone test (IPHONE_TEST_PLAN.md).
4. Merge #26.

## Fixed values used by the code

| What | Value |
|---|---|
| Apple Team ID | `A7V4PN4DWK` |
| iOS bundle ID | `com.afiyeat.app` (test app: `com.afiyeat.app.authtest`) |
| Website Services ID | `com.afiyeat.web` (`APPLE_SERVICES_ID`, overridable with `VITE_APPLE_SERVICES_ID`) |
| Backend (Lovable Cloud / Supabase) project | `dmlkjpjubneqhbqoxlct` |
| iPhone callback (Google, browser-Apple) | `com.afiyeat.app://auth/callback` |
| Website callback | `https://afiyeat.com/auth-callback.html`, `https://www.afiyeat.com/auth-callback.html` |
| Terms and Privacy versions accepted at setup | `2026-10-07` (`TERMS_VERSION` / `PRIVACY_VERSION`; must match `complete_account_setup()`) |

---

## A. Apple Developer (developer.apple.com → Certificates, IDs & Profiles)

1. **App ID `com.afiyeat.app`:** turn on **Sign in with Apple** as a primary App ID.
   - The branch adds the `com.apple.developer.applesignin` entitlement, so Xcode signing for the real app fails until this is on. Xcode's automatic signing usually turns it on when you build, if your account has Admin rights.
2. **Services ID for the website:** `com.afiyeat.web`.
   - Turn on Sign in with Apple, then Configure. Set the primary App ID to `com.afiyeat.app`.
   - **Domains:** `dmlkjpjubneqhbqoxlct.supabase.co`, `afiyeat.com` and `www.afiyeat.com`.
   - **Return URLs:**
     - What Lovable's Apple settings show under Redirect URL(s). Expect `https://dmlkjpjubneqhbqoxlct.supabase.co/auth/v1/callback`, but use what Lovable shows.
     - **Also** `https://afiyeat.com/auth-callback.html` and `https://www.afiyeat.com/auth-callback.html`. On the website, Sign in with Apple JS uses these to confirm an account deletion.
3. **Key:** create a Sign in with Apple key with primary App ID `com.afiyeat.app`.
   - Download the `.p8` once, note the **Key ID**, and keep the `.p8` in a password manager.
   - It is used in two places:
     - Lovable's **Generate secret** helper (C2).
     - The `APPLE_PRIVATE_KEY` Edge Function secret for `delete-account` (PR #27).
4. **Calendar reminder: the backend's Apple client secret expires within 6 months.** Website sign-in stops when it does. Regenerate it in Lovable from the same `.p8`.
   - Native iPhone sign-in does not use that secret.
   - `delete-account` signs its own 5-minute secret on each use, so it isn't affected either.
5. **Hide My Email relay:** to email `@privaterelay.appleid.com` addresses (OTP, password reset, notices), register the sending domain and address under **Sign in with Apple for Email Communication**. They must pass SPF, or Apple drops the email.
6. **Test app only:** register App ID `com.afiyeat.app.authtest` with Sign in with Apple, choosing **Group with an existing primary App ID → `com.afiyeat.app`**. The test app then shares the real app's Sign in with Apple consent. Remove it after testing.
7. **Before App Store submission (owner action):** replace the Apple logo in `src/components/auth/SocialSignInButtons.tsx` with Apple's own artwork from **Apple Design Resources** ("Sign in with Apple" logo files, SVG).
   - Apple's guidelines allow only that artwork in a custom Sign in with Apple button ("never create a custom Apple logo"). The file's height should match the button's.
   - The download requires accepting Apple's terms, so it couldn't be added here.

## B. Google Cloud Console (Google Auth Platform)

1. **Branding:** app name `Afiyeat`, a support email, and links to `https://afiyeat.com/privacy` and `https://afiyeat.com/terms`.
   - Authorized domains: `afiyeat.com` and `supabase.co`.
   - Scopes: `openid`, `email` and `profile` only.
2. **Audience → Publishing status:**
   - **During the iPhone trial, keep "Testing" and add the test Google accounts as test users.**
     - Google's production-readiness overview says an app in Testing that requests only the basic identity scopes (`openid`, `email`, `profile`) can be used by any Google account, with a "this app is in testing" warning screen.
     - The older Cloud help page still says only listed test users. Listing the testers avoids depending on that exception.
     - A test user's authorization expires 7 days after consent, so Google asks again the next time. Afiyeat's own session isn't affected.
   - **Before public launch, choose "Publish app" (In production).**
     - Basic scopes need no scope verification.
     - Google shows the app's **name and logo** on the consent screen only after **brand verification**. Until then they're hidden. Submit it before launch.
3. **Clients → Create client → "Web application".** Do not create an iOS client: the app uses Google through the secure system browser sheet, not the Google iOS SDK, and Lovable accepts only one Google client.
   - **Authorized JavaScript origins:** `https://afiyeat.com` and `https://www.afiyeat.com`.
   - **Authorized redirect URIs:** exactly what Lovable's Google settings show. Expect `https://dmlkjpjubneqhbqoxlct.supabase.co/auth/v1/callback`.
4. Copy the Client ID and secret into Lovable only, in C1.

## C. Lovable Cloud (project → Cloud → Users → Settings / Auth settings)

1. **Google:**
   - Turn it on and choose **Your own credentials**. **Not "Managed by Lovable"**: Lovable's docs say managed mode uses Lovable's own OAuth client, and a separately built native app can't use it.
   - Paste the Client ID and secret, tick the redirect URIs you added in Google Cloud, then Save.
2. **Apple:**
   - Turn it on and choose **Your own credentials**.
   - **Client ID:** `com.afiyeat.web,com.afiyeat.app`, with the **Services ID first** and no spaces.
     - Supabase's Apple guide says to list the Services ID first when native sign-in is also used: the first ID is used for the website, and every listed ID is accepted for native identity tokens.
     - For the test app, add `,com.afiyeat.app.authtest` and remove it after testing.
     - Lovable's docs describe the field as holding one ID, so check that it saves. If it doesn't:
       - **Option 1:** enter `com.afiyeat.web` and build the iPhone app with `VITE_APPLE_SIGN_IN_IOS=browser`. Apple then opens in the secure browser sheet on iPhone.
       - **Option 2:** enter `com.afiyeat.app` and build the website with `VITE_APPLE_SIGN_IN_WEB=off`.
   - **Client secret:** use **Generate secret** with the `.p8`, its Key ID, `com.afiyeat.web` and Team ID `A7V4PN4DWK`.
   - **Allow users without an email:** leave **off**.
3. **Redirect URLs** (allow-list):
   - `com.afiyeat.app://auth/callback`
   - `https://afiyeat.com/auth-callback.html`
   - `https://www.afiyeat.com/auth-callback.html`
   - Optional for local web testing, then remove: `http://localhost:8080/auth-callback.html`
   - Leave **Site URL** as `https://afiyeat.com`.
4. **Manual linking** (beta in Supabase; off by default): turn it **on** if Lovable offers it, or ask Lovable support. Profile › Sign-in methods › **Connect** needs it. Without it, Connect explains that it isn't switched on, and nothing else is affected.
5. **Check:** open `https://dmlkjpjubneqhbqoxlct.supabase.co/auth/v1/settings?apikey=<publishable key from .env>`. `"external"` should show `"apple": true` and `"google": true`.

## How existing accounts are kept

This follows Supabase's identity-linking guide.

- **Automatic linking:** Supabase links identities with the **same email address** to one user. The ID, lists, recipes, photos, followers and referrals stay the same.
  - It doesn't link to an **unverified** email address.
  - When it links, it **removes any unconfirmed identities** on the existing user. This protects against someone pre-registering an address they don't own.
  - Afiyeat's email sign-ups are created confirmed (`create-account` sets `email_confirm: true`).
- **Different email** (Hide My Email, another Gmail): the sign-in creates a new, empty account.
  - The setup screen's **"Already have an Afiyeat account?"** removes it, **only if the server confirms it is brand new and untouched**: `delete-account` `discard_new_account` plus `social_account_discard_check`, PR #27.
  - The person then signs in with email and uses Profile › Sign-in methods › **Connect**, which needs manual linking. Supabase refuses a link if that Apple or Google identity already belongs to another user. The app says so.
  - There's no "disconnect" button. Supabase requires at least two identities to unlink, and removing one can lock people out.
- **Terms acceptance** for new Apple and Google accounts is stored server-side in `public.terms_acceptances`.
  - It is written only by `complete_account_setup()`, with the server's clock and the current version, in the same transaction as the username.
  - It is no longer stored in the account's own editable `user_metadata`.
  - Email sign-up is unchanged. Recording its acceptance the same way would be a separate, optional change to `create-account`.
- **Before setup is finished**, a new Apple or Google account:
  - registers no push token,
  - writes no timezone,
  - claims no invite,
  - and writes nothing to its profile.

  The name Apple shares once is kept on the device only, for the setup form.

## Account deletion and Sign in with Apple (App Review 5.1.1(v), Apple TN3194)

- Deleting an account that has Apple connected asks the person to confirm with Apple: the native sheet on iPhone, Apple's popup on the website.
- `delete-account` then **revokes Afiyeat's Apple authorization before deleting**.
- If that can't be done, nothing is deleted and the person chooses:
  - **Confirm with Apple** again, or
  - **Delete anyway**, then remove Afiyeat from their Apple Account's Sign in with Apple list themselves (TN3194 requires the deletion to be honoured regardless).
- When someone turns off Sign in with Apple for Afiyeat in Settings, the iPhone app signs them out on next launch or return to the app. This uses `getCredentialState`, as TN3194 recommends.

## Checked against official documentation (2026-11-22)

- **Apple HIG, Sign in with Apple:** custom button rules.
  - Titles: Sign in / Sign up / Continue with Apple.
  - Black fill with white logo and title.
  - Title at 43% of the button height (19 pt in 44 pt); system font preferred.
  - At least 140 × 30 pt; margin at least 1/10 of the height.
  - No smaller than other sign-in buttons, and shown first.
  - Logo artwork must come from Apple Design Resources (open item A7).
  - People should be able to see their relay address: Profile › Sign-in methods shows the email each provider uses.
- **Google, Sign in with Google branding guidelines:** "Continue with Google"; white fill with a 1 px #747775 stroke; #1F1F1F text, Google Sans Medium 14/20; the standard-colour "G" at its standard size; iOS padding 16 / 12 / 16; at least as prominent as other options.
  - Google Sans isn't bundled. The button falls back to Roboto, then Arial. Bundling the font is an owner choice.
- **Accessibility:**
  - Buttons have visible text labels and 44 pt height.
  - Logos are hidden from VoiceOver.
  - Busy spinners have labels; keyboard focus rings are kept.
  - Contrast is black/white and #1F1F1F on white.
- **Callbacks:** iPhone uses ASWebAuthenticationSession with a scheme that isn't registered, so the result is returned only to Afiyeat. Google sees a Web client redirecting to the backend, never an embedded web view. The website uses a static callback page with PKCE.
- **Supabase:**
  - Apple guide: comma-separated Client IDs with the Services ID first; the 6-month secret applies to the OAuth (web) flow only.
  - Identity-linking guide: the automatic, manual and unlinking rules above.
- **Apple TN3194:** revoke with a refresh or access token; Afiyeat gets one from a fresh authorization code at deletion. If not revoked, the next sign-in skips the first-time sheet (no name or email choice). Handle revoked credentials.
- **Google production-readiness overview:** Testing vs Production, the basic-scope exception, and brand verification, as in B2.
