# Sign in with Apple and Continue with Google: owner setup

Branch `feat/social-sign-in`. This page lists every setting the code depends on. It contains no secrets, and none are needed in the repo.

**Never put these in the repo, a chat or a ticket:** the Apple `.p8` key, the Apple client secret (JWT) or the Google client secret. They go only into Lovable Cloud's auth settings.

Until Apple or Google is switched on in Lovable Cloud, the app shows no new buttons. It reads which providers are on from the backend's public `/auth/v1/settings`. Merging the code before setup is finished therefore changes nothing for users, apart from the iOS entitlement described in step A1.

## Fixed values used by the code

| What | Value |
|---|---|
| Apple Team ID | `A7V4PN4DWK` |
| iOS bundle ID | `com.afiyeat.app` |
| Backend (Lovable Cloud / Supabase) project | `dmlkjpjubneqhbqoxlct` |
| iPhone callback (Google, browser-Apple) | `com.afiyeat.app://auth/callback` |
| Website callback | `https://afiyeat.com/auth-callback.html`, `https://www.afiyeat.com/auth-callback.html` |
| Terms version recorded for new social accounts | `2026-10-07` (`TERMS_VERSION` in `src/lib/socialAuth/config.ts`) |

---

## A. Apple Developer (developer.apple.com → Certificates, IDs & Profiles)

1. **App ID `com.afiyeat.app`:** turn on the **Sign in with Apple** capability as a primary App ID, then save.
   - The branch adds the `com.apple.developer.applesignin` entitlement. Until the capability is on, Xcode signing for the real app fails. Xcode's automatic signing usually turns the capability on by itself when you build, if your account has Admin rights.
2. **Services ID for the website**, e.g. `com.afiyeat.web` (Identifiers → + → Services IDs):
   - Turn on Sign in with Apple, then Configure. Set the primary App ID to `com.afiyeat.app`.
   - **Domains:** the backend host `dmlkjpjubneqhbqoxlct.supabase.co`, plus any domain Lovable lists.
   - **Return URLs:** copy them exactly from Lovable's Apple settings, in the **Redirect URL(s)** field. Expect `https://dmlkjpjubneqhbqoxlct.supabase.co/auth/v1/callback`, but use what Lovable shows.
3. **Key** (Keys → +):
   - Turn on Sign in with Apple and pick `com.afiyeat.app`. Download the `.p8` once and note the **Key ID**.
   - Store the `.p8` in a password manager. It is used only in Lovable's **Generate secret** helper.
4. **Calendar reminder: the client secret expires within 6 months.** Website Apple sign-in stops working when it does. Regenerate it in Lovable from the same `.p8`. Native iPhone sign-in uses the identity token and is not affected by expiry.
5. **Hide My Email relay:** to send email to `@privaterelay.appleid.com` addresses (OTP, password reset, any notices), register the sending domain and address under **Sign in with Apple for Email Communication**. They must also pass SPF. Otherwise Apple drops the email.
6. **iPhone test build only:** register the App ID `com.afiyeat.app.authtest` with Sign in with Apple on. See C2 for the client ID it needs.

## B. Google Cloud Console (console.cloud.google.com)

1. **OAuth consent screen:**
   - App name `Afiyeat`, a support email, and logo/links to `https://afiyeat.com/privacy` and `https://afiyeat.com/terms`.
   - Authorized domains: `afiyeat.com` and `supabase.co`.
   - Scopes: `openid`, `email` and `profile` only.
   - **Publish to Production.** In "Testing" mode only listed test users can sign in.
2. **Credentials → Create OAuth client ID → type "Web application".** Do not create an iOS client: the app uses Google through the secure system browser sheet, not the Google iOS SDK, and Lovable accepts only one Google client.
   - **Authorized JavaScript origins:** `https://afiyeat.com` and `https://www.afiyeat.com`.
   - **Authorized redirect URIs:** copy them exactly from Lovable's Google settings. Expect `https://dmlkjpjubneqhbqoxlct.supabase.co/auth/v1/callback`.
3. Copy the **Client ID** and **Client secret** into Lovable only, in section C.

The Google consent screen will say "to continue to dmlkjpjubneqhbqoxlct.supabase.co" unless the backend gets a custom auth domain. That is cosmetic. Branding verification in Google Cloud improves it.

## C. Lovable Cloud (project → More/Cloud → Users → Settings / Auth settings)

1. **Google:**
   - Turn it on and choose **Your own credentials**. **Not "Managed by Lovable"**: managed mode uses Lovable's own OAuth client and broker, which a native iPhone app can't use.
   - Paste the Client ID and secret from B3. Tick the redirect URIs you added in Google Cloud, then Save.
2. **Apple:**
   - Turn it on and choose **Your own credentials**.
   - **Client ID:** first try **`com.afiyeat.web,com.afiyeat.app`**, with the Services ID first and no spaces. The backend (Supabase Auth) accepts a comma-separated list: the first ID is used for the website and every ID is accepted for native identity tokens. Lovable's docs describe the field as holding one ID, so check it saves and works.
     - **If only one ID is accepted:**
       - **Option 1, recommended:** enter `com.afiyeat.web`, and build the iPhone app with `VITE_APPLE_SIGN_IN_IOS=browser`. Apple then opens in the secure browser sheet on iPhone instead of the native Face ID sheet. Both platforms work.
       - **Option 2:** enter `com.afiyeat.app`, and build the website with `VITE_APPLE_SIGN_IN_WEB=off`. You get the native sheet on iPhone and no Apple button on afiyeat.com.
     - **For the iPhone test build** (bundle `com.afiyeat.app.authtest`), native Apple needs that ID in the list too: `com.afiyeat.web,com.afiyeat.app,com.afiyeat.app.authtest`. Remove it after testing. If you can't add it, run the test script with `--apple-browser`.
   - **Client secret:** use **Generate secret** with the `.p8`, Key ID `…`, Services ID `com.afiyeat.web` and Team ID `A7V4PN4DWK`.
   - **Allow users without an email:** leave **off**. An email is needed for automatic account linking and support.
3. **Redirect URLs** (allow-list), added exactly:
   - `com.afiyeat.app://auth/callback`
   - `https://afiyeat.com/auth-callback.html`
   - `https://www.afiyeat.com/auth-callback.html`
   - Optional, for local web testing only, then remove: `http://localhost:8080/auth-callback.html`
   - Leave **Site URL** as `https://afiyeat.com`.
4. **Manual linking** ("Allow manual linking" / `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED`): turn **on** if Lovable offers it, or ask Lovable support. Profile › Sign-in methods › **Connect** needs it. Without it, Connect shows "Connecting … isn't switched on yet" and nothing else breaks.
5. **Check:** open `https://dmlkjpjubneqhbqoxlct.supabase.co/auth/v1/settings?apikey=<publishable key from .env>` in a browser. `"external"` should show `"apple": true` and `"google": true`.

## How existing accounts are kept (no database changes)

- **Automatic linking** is built into Supabase Auth and can't be switched off. A Google or Apple sign-in whose **verified email matches** an existing account signs into that account. The user ID, lists, recipes, photos, followers and referrals stay the same.
  - Accounts made by the email sign-up are created with a confirmed email (`create-account` sets `email_confirm: true`), so they qualify.
- **Different email** (Apple Hide My Email, another Gmail): sign-in creates a new, empty account.
  - The setup screen offers **"Already have an Afiyeat account?"**. It removes that brand-new empty account (via the existing `delete-account` function) and explains how to connect Apple or Google from Profile › Sign-in methods on the real account.
  - It's offered only for an Apple/Google-created account with no username and no email sign-in.
- No migration, trigger, RLS or Edge Function was changed:
  - `handle_new_user` already creates the profile for social sign-ups with a `NULL` username.
  - Setup fills in the username and display name through the existing own-row update policy.
  - Acceptance of the Terms is stored in the account's auth metadata as `terms_accepted_at` and `terms_version`.

## Still required before App Store submission (needs PM approval: Edge Function + secrets)

- **Apple token revocation on account deletion (App Review guideline 5.1.1(v)).** When a user who signed in with Apple deletes their account, the app must revoke their Apple tokens through Apple's REST API.
  - This needs a server-side step: store the Apple refresh token at sign-in, or exchange the `authorizationCode` the native plugin already returns, then call `https://appleid.apple.com/auth/revoke` from `delete-account` using the client secret.
  - This is not implemented on this branch. Today, deleting an Apple account removes all Afiyeat data, but Afiyeat stays listed under the user's Apple Account › Sign in with Apple until they remove it.
- **App Store privacy answers:** add "Apple ID / Google account: email, name (optional), user ID — used for app functionality (sign-in)". Add Apple and Google to the review notes. The reviewer can use the email demo account as before.
- **Website:** afiyeat.com shows the buttons only after this branch is merged and published by Lovable.
  - `public/.well-known/apple-app-site-association` must **not** list `/auth*` or `/auth-callback.html`. It doesn't today. Otherwise iPhone Safari would hand the web callback to the app.
