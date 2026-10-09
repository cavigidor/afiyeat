# Afiyeat: final test before submitting

Run this on the **TestFlight build** (see RELEASE_CHECKLIST.md §D), as a user would. Tick each box, or note what you actually saw.

**You'll need:**
- **Account A:** your normal account (admin).
- **Account B:** a brand-new email, for sign-up, referral and safety tests. Use a fresh address each time you rerun the referral tests.
- **A private Safari window,** to see what someone without the app or an account sees.

---

## 1. First launch and sign-up
- [ ] Delete the app, then install from TestFlight. The icon name reads **Afiyeat**.
- [ ] The splash goes straight to sign-in, with no flash of the website and **no permission pop-ups**.
- [ ] Sign Up as B: **Continue does nothing until the Terms/Privacy box is ticked**. The links open the right pages.
- [ ] The email code arrives and works. Entering the same code again fails.
- [ ] Forgot password: a code arrives, the new password works, and the old one doesn't.

## 2. Accounts on one phone
- [ ] Signed in as A, open My Restaurants. Log out and sign in as B: **none of A's places, lists or photos show**, even briefly.

## 3. Places (as A)
- [ ] My Restaurants: the round **+ Add place** button sits above the tab bar and doesn't cover the last card.
- [ ] Search a restaurant: Apple results appear. Pick one and save. **The address shows on the card and there's a pin on the map.**
- [ ] On the Been There tab, Add place starts as **Been There**. With a type filter selected, that type is pre-ticked.
- [ ] Edit a place and save without changes: the address is still there afterwards.
- [ ] Add a place by typing a name only (no search): it saves.
- [ ] Adding the same place twice says it's already on your list.
- [ ] Delete a place.

## 4. Maps
- [ ] Pins show your types' colours and emoji. Tap a pin: a bubble with **Apple Maps / Google Maps** links. The links open directions.
- [ ] Tap a place in the list: the map flies to it and opens its bubble.
- [ ] **Near Me** asks for location the first time. Allow it: the map centres on you.
- [ ] Settings → Afiyeat → Location → Never, then reopen: maps still work, and Near Me explains how to turn location back on.
- [ ] Pinch and pan on the map work smoothly.

## 5. Lists
- [ ] New List → **Coffee Shops** preset → add a place by search (address and pin show) → it appears on that list's map.
- [ ] New List → **Books** preset → add a book (no location) → statuses are Want to Read / Reading / Read.
- [ ] Shared list with B: add a place, and B sees it. B adds a comment, and A sees it.

## 6. Recipes
- [ ] Foodie → Add Recipe by typing: it saves.
- [ ] **Scan Recipe** the first time shows **"Scan with AI"** with Continue / Type it in instead.
  - [ ] "Type it in instead" opens an empty recipe.
  - [ ] Continue → pick a recipe photo → the form fills in, and **Public is off** by default.
- [ ] The second scan skips the permission screen.

## 7. Friends and Explore
- [ ] Follow B from B's profile; B's places show on the Friends tab map.
- [ ] Make B private. As A (if you don't follow B), B's Explore comments show as **Anonymous** with no notes, and B's lists aren't listed.
- [ ] Explore → places map and list load. Tapping a place shows details and "Add to a List".
- [ ] Explore → Events: map pins. Moving the map shows **Search this area**.

## 8. Sharing, links and Passport
- [ ] Share a place to yourself in Messages and tap it: **the app opens on that place**. If Safari opens, long-press → Open in Afiyeat.
- [ ] Open the same link in a private Safari window: you see the place with its address and a Join card, not a login wall.
- [ ] As A, copy your Passport invite link. Sign up a new B through it: B gets "A invited you". After B saves 3 places, A's Passport shows the stamp.

## 9. Safety and moderation
- [ ] A content filter: a note containing a slur is refused; "damn good ramen" saves.
- [ ] As B, report one of A's places ("…" → Report): **an email arrives at support@afiyeat.com within a minute**.
- [ ] As A: avatar menu → **Moderation** shows the report with a preview of the place.
- [ ] **Hide content:** B (and a private window) can no longer see that place; A still can. **Show again:** it's back.
- [ ] Reporting the same thing twice says "already reported".
- [ ] B blocks A: neither sees the other's places, lists or recipes; follows between them are removed; **Unblock** in Profile works.

## 10. Account and help
- [ ] Profile → **Help & Support** opens. "Email support" opens Mail with the build in the message, and "Copy address" works.
- [ ] Privacy Policy and Terms open from Support and from sign-up.
- [ ] Delete account B (Profile → Danger Zone): you're signed out, can't sign back in, and B's places no longer show for A.

## 11. Website (afiyeat.com, on a computer)
- [ ] The landing page, /privacy, /terms and /support look right.
- [ ] Signing in works, and the maps show Apple Maps.

---

## Expected in 1.0 (not bugs)
- No notification permission prompt; notifications are off for launch.
- No News tab; it's hidden for launch.
- iPhone only: on iPad the app runs in iPhone mode.
- 8 old places without an Apple match keep their original details until re-added through search.
