# Release checklist: Afiyeat 1.0

Work top to bottom. Companion docs:
- `APP_STORE_METADATA.md`: listing text, screenshots, age rating
- `APP_REVIEW_NOTES.md`: demo accounts and reviewer notes
- `APP_PRIVACY_LABELS.md`: privacy answers
- `USER_TEST_CHECKLIST.md`: the full test on your phone

---

## A. Before you build

- [ ] Everything is pushed (`git status` is clean, then `git pull --no-rebase --no-edit && git push`) and Lovable has published afiyeat.com.
- [ ] Every migration is applied in Lovable (the latest is `20261010120000_moderation_enforcement`).
- [ ] The deployed edge functions match the repo, and the Mapbox ones are deleted.
- [ ] https://afiyeat.com/.well-known/apple-app-site-association shows the `applinks` text.
- [ ] https://afiyeat.com/privacy, /terms and /support load, signed out.
- [ ] An email sent to support@afiyeat.com arrives in your Gmail.
- [ ] Your account has the `admin` role, so the Moderation menu shows.
- [ ] Both demo accounts are set up (`APP_REVIEW_NOTES.md` §1).

## B. Build for the App Store (Xcode)

1. Terminal:
   ```
   cd ~/Desktop/ME/Projects/afiyeat/afiyeat-app
   npm install
   npm run build && npx cap sync ios
   npx cap open ios
   ```
2. **App target → General:**
   - **Version** `1.0`
   - **Build** `1`
   - Increase Build by 1 for every later upload: 2, 3, …
   - Version stays 1.0 until release.
3. **App target → Signing & Capabilities:** no red errors. Push Notifications and Associated Domains are listed.
4. At the top, set the run destination to **Any iOS Device (arm64)**. Not your phone, and not a simulator.
5. **Product → Archive.** Wait for the Organizer window.
6. In Organizer, select the new archive → **Distribute App** → **App Store Connect** → **Upload** → keep the defaults (automatic signing) → **Upload**.
   - Xcode switches push to the production environment for this build automatically. Nothing to change.
7. If Xcode asks about **encryption**: the app declares it uses only standard encryption (HTTPS), so there's nothing to fill in.

## C. App Store Connect: create the app (first time only)

**appstoreconnect.apple.com → Apps → + → New App:**

| Field | Value |
|---|---|
| Platforms | iOS |
| Name | `Afiyeat: Food Lists & Recipes` |
| Primary language | English (U.S.) |
| Bundle ID | `com.afiyeat.app` |
| SKU | `afiyeat-ios` |
| User access | Full Access |

## D. TestFlight: test the real build

- [ ] The upload appears under **TestFlight** after 10–30 minutes of "Processing".
- [ ] Add yourself under **Internal Testing**, install **TestFlight** from the App Store on your phone, and install Afiyeat from it.
- [ ] Delete the Xcode-installed copy first, so you're testing exactly what Apple will review.
- [ ] Run `USER_TEST_CHECKLIST.md` on this TestFlight build.
- [ ] Found a problem? Fix it, upload a new build (Build +1), and test again.

## E. Fill in the App Store page

**App Store tab → 1.0 Prepare for Submission:**
- [ ] Screenshots: 6.9" iPhone set (`APP_STORE_METADATA.md`)
- [ ] Promotional text, description, keywords, support URL, marketing URL
- [ ] **Build:** choose the TestFlight build you tested
- [ ] **App Review Information:** demo sign-in, contact details and notes (`APP_REVIEW_NOTES.md` §2)
- [ ] **Version Release:** choose **"Manually release this version"**, so it goes live when you say so after approval

**App Information:**
- [ ] Subtitle, categories, content rights, privacy policy URL
- [ ] Age rating questionnaire (`APP_STORE_METADATA.md`)

**App Privacy:**
- [ ] Answers from `APP_PRIVACY_LABELS.md`, then **Publish**

**Pricing and Availability:**
- [ ] Price **Free**
- [ ] Countries: all, or start with the United States

## F. Submit

- [ ] **Add for Review → Submit to App Review.**
- [ ] Review usually takes 1–3 days. Watch your email and **App Store Connect → Resolution Center**.
- [ ] Check support@afiyeat.com and the Moderation screen daily during review: reviewers may file a test report.

## G. After approval

- [ ] Press **Release This Version**.
- [ ] Paste the App Store link into `APP_STORE_URL` at the top of `src/pages/Index.tsx` (or send it to me). The landing page then shows the App Store button.
- [ ] Check reports and support email daily.
- [ ] For later updates: same steps B → F, with Version 1.0.1 / 1.1 and a new Build number.
