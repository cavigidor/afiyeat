# App Review: demo accounts and notes

Apple's reviewer needs to sign in and try everything, including reporting and blocking. Prepare this **before** submitting, because a reviewer who can't sign in rejects the build straight away (guideline 2.1).

---

## 1. Create two demo accounts

Use two email addresses you control and won't use for anything else, e.g. `review1@afiyeat.com` and `review2@afiyeat.com`. Add both as aliases in IONOS → Email Forward (like support@), so their sign-up codes reach your Gmail.

Sign up each one **in the app**, the normal way, with the email code.

**Account 1: the one the reviewer signs in with**
- Username: `afiyeat_review`, display name "Review Demo", profile **public**
- Add 6–8 real restaurants through search, some To Go and some Been There, with ratings, short notes and one or two photos (dishes, not people)
- Create two or three types (e.g. Brunch, Date night) and assign them
- Create two lists from presets (e.g. Coffee Shops with a few places, Books with a few titles)
- Add one recipe: type one in, and scan one if you like
- Follow Account 2

**Account 2: something to report and block**
- Username: `afiyeat_review_friend`, profile **public**
- Add 3–4 restaurants and one public recipe
- Follow Account 1 back, and create a shared list between the two accounts with a couple of places

Then sign in once as Account 1 on a clean install, to check everything shows.

Use a long, unique password for each. Enter them only in App Store Connect (below), never in this repo or in chat.

---

## 2. App Store Connect → App Review Information

| Field | Value |
|---|---|
| Sign-in required | Yes |
| User name | Account 1's email |
| Password | Account 1's password |
| Contact first/last name | Your name |
| Contact phone | Your phone, with country code |
| Contact email | support@afiyeat.com (forwards to you) |
| Attachment | Not needed |

### Notes (paste; 4000 characters max)

```
Thank you for reviewing Afiyeat.

SIGN IN
Use the demo account above with "Sign In" (email and password). Sign-up needs a 6-digit email code, so please use the existing demo account rather than creating a new one.

WHAT THE APP DOES
Afiyeat lets people save restaurants they want to try or have been to, see them on a map, keep other lists (coffee shops, books, movies), save recipes, and share with friends.
- Foodie tab: recipes. "Scan Recipe" reads a recipe from a photo (see AI below).
- My Lists tab: "My Restaurants" (To Go / Been There, map, ratings) and other lists.
- Friends tab: people you follow and shared lists.
- Explore tab: places others have been, and nearby events.

USER-GENERATED CONTENT SAFETY (Guideline 1.2)
- Terms: sign-up requires agreeing to the Terms of Service, which state zero tolerance for objectionable content and abusive users.
- Filtering: posts, notes, names and comments are checked for slurs and spam before saving.
- Reporting: open another user's profile, list or recipe and tap the "..." menu, then Report. The demo account follows "afiyeat_review_friend", whose profile is available to try this on.
- Blocking: same "..." menu, then Block. Blocked users' content disappears both ways; manage in Profile > Blocked accounts.
- Every report emails the developer immediately and appears in a moderation queue. Content reported by several people is hidden automatically until reviewed. We act on reports within 24 hours.
- Contact: Profile > Help & Support, or https://afiyeat.com/support (support@afiyeat.com).

ACCOUNT DELETION (Guideline 5.1.1(v))
Profile > scroll to Danger Zone > Delete Account. This permanently deletes the account and its data.

PERMISSIONS
Nothing is requested at launch. Location is requested only when the user taps "Near Me" or opens a map, and the app works fully if it is declined. Camera and photos are requested only when the user adds a photo or scans a recipe.

AI (Guideline 5.1.2(i))
Recipe scanning sends the chosen photo to Google's Gemini model (via our AI provider) to read the recipe text. Before the first scan the app explains this and asks for permission, with an option to type the recipe in instead. Photos are not stored.

MAPS
Maps and place search use Apple Maps (MapKit JS and the Apple Maps Server API).

NOT IN THIS VERSION
- No in-app purchases, subscriptions or ads.
- The app does not ask for notification permission in this version.
- Links to afiyeat.com for places, lists, profiles and invites open in the app when it is installed (Universal Links).

Thank you!
```

---

## 3. If App Review comes back with questions

- **Reply in App Store Connect → Resolution Center,** briefly and politely. Most first-time issues are clarifications, not real rejections.
- **"Couldn't sign in":** check the demo password still works on a fresh install, then reply with confirmation.
- **"Minimum functionality" (4.2):** reply pointing to the native features: Apple Maps, camera recipe scanning, Universal Links, haptics and native share sheets. Ask for specifics.
- **For any rejection,** send me the exact text and we'll address it together.
