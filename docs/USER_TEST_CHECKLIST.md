# Afiyeat — user test checklist

Work through this on a real iPhone, as a user would. Tick each box or note what you actually saw.

**You'll need**
- **Account A**: your normal account.
- **Account B**: a brand-new email address, for the referral and blocking tests. Use a different new address each time you rerun the referral tests, because reusing one is now deliberately refused.
- A private browser window (Safari: tabs → Private), to see what a friend without an account sees.

**Before you start**
- [ ] Profile → bottom shows a build stamp matching the latest commit (`git rev-parse --short HEAD`).
- [ ] All Lovable migrations are applied, including `20260930120000_referral_hardening_and_history`.

---

## 1. First launch
Delete the app first, then install fresh from Xcode.

- [ ] The name under the icon reads **Afiyeat** (capital A).
- [ ] The splash screen goes straight to sign-in, with no flash of the marketing website.
- [ ] **No** location or notification pop-up appears on launch.
- [ ] After signing in you land on Foodie, again with no pop-ups.

## 2. Permissions only when needed
- [ ] News: no location pop-up. Tap the arrow button next to the city picker → location is asked for → the city changes.
- [ ] Tap "Don't Allow" on location → the app still works, and maps centre on your saved places.
- [ ] Opening a map or tapping Near Me asks for location if you haven't answered yet.
- [ ] Adding a photo asks for camera/photos at that moment, and the wording makes sense.

## 3. Look and feel (recent fixes)
- [ ] The header is slimmer and the logo is crisp.
- [ ] My Restaurants in grid view: the **"…" button is visible on every card** → Mark visited / Edit / Delete all work.
- [ ] Add Restaurant and recipe pop-ups fit on screen, and don't jump around when the keyboard opens.
- [ ] Long-pressing a button or card shows no copy/share bubble, but text fields still let you paste.
- [ ] Switching between bottom tabs keeps your scroll position.
- [ ] The avatar menu shows Profile / **Invite friends** / Log out.

## 4. Lists
- [ ] New List → tap **Books** → the switches below change, the chip is highlighted, and a line says "Set up for books…".
- [ ] Create it → statuses are Want to Read / Reading / Read, and the card shows 📚.
- [ ] Try each preset (Movies, Shows, Concerts, Wines, Beers, Coffee Shops). Do the fields fit how you'd use that list?
- [ ] Pick a preset, then rename the list → the settings stay.
- [ ] Add Restaurant → **Types are tappable chips, and you can select more than one**.

## 5. Content filter
- [ ] A restaurant note containing a slur is refused with a message, and nothing is saved.
- [ ] Normal food writing still saves, e.g. "damn good ramen" or "retard the dough overnight".
- [ ] The filter also applies to recipe text, list names, comments, and your profile name and bio.

## 6. Report and block (A and B)
- [ ] As A, open B's profile → "…" → Report → pick a reason → "Report sent".
- [ ] "Something else" won't send until you write something.
- [ ] Reporting the same thing again → "You've already reported this".
- [ ] Report from a recipe and from a list too (the "…" menu is there now).
- [ ] Block B → the confirmation is clear → you're taken off their profile.
- [ ] B's restaurants, lists and recipes no longer show up for A, **and** A's no longer show for B.
- [ ] Any follow between A and B is removed in both directions.
- [ ] Profile → Blocked accounts lists B → Unblock works.
- [ ] Your report appears in the moderation queue (ask Lovable to show `moderation_queue`).

## 7. Sharing
- [ ] A restaurant's detail → Share → the share sheet opens, and the message reads naturally.
- [ ] Open that link in a **private window** → you see the place plus a "Join Afiyeat" card, not a login screen.
- [ ] Share a list → the private window shows its places (up to 12) plus Join.
- [ ] A public recipe → Share → the private window shows the whole recipe. Private recipes have no Share button.
- [ ] With your profile set to private, sharing warns that only followers can open it, and the private window says "isn't available".
- [ ] Signed in as B, open A's restaurant link → "Save to my places" adds it to To Go. Doing it twice → "already in your restaurants".

## 8. Referral and Passport (A and a brand-new B)
- [ ] A: Passport shows an invite link with a 7-character code. Copy and Invite friends both work.
- [ ] Private window: open a **restaurant** link shared by A → Join → sign up as B.
- [ ] B lands back on **that restaurant**, not the home screen.
- [ ] B sees **"A invited you to Afiyeat"** → Follow works (it becomes a request if A is private). "Not now" closes it.
- [ ] A's Passport shows B under "Friends you've invited" as "Joined — getting started".
- [ ] B saves 3 restaurants → A's Passport shows "stamp earned" and 1 friend joined.
- [ ] A's profile shows a **Table for Two** badge, and B can see it there too.
- [ ] **Loophole check:** delete account B, then sign up again through A's link with the same email (or `name+test@`) → no welcome and no new referral.
- [ ] An existing account opening A's link gets nothing credited.
- [ ] A opening their own link gets nothing credited.

## 9. Notifications
- [ ] Following someone shows **no** notification prompt. That's expected: it's switched off until a real notification is confirmed to arrive.

## 10. Account
- [ ] Log out and Delete account are clearly different, and Delete asks for confirmation.
- [ ] After deleting a test account: you can't sign in with it, and its places no longer show for others.

## 11. Website (afiyeat.com, after Lovable publishes)
- [ ] The new landing page looks right on phone and desktop, with no header overlap.
- [ ] "Join" goes to sign-up and "Sign in" to sign-in. Footer links switch pages without a full reload.
- [ ] Visiting afiyeat.com while signed in takes you straight into the app.

---

## Known gaps — not bugs
These are expected right now. Don't log them as failures:
- Shared links open in Safari rather than the app (Universal Links aren't set up yet).
- Every shared link previews as the generic Afiyeat card in iMessage.
- Push notifications are off until the APNs keys and internal secret are confirmed.
- Goodreads and Letterboxd import aren't built yet.
- There's no activity inbox: follow requests only show on Profile.
