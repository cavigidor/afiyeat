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
- [ ] A list's header shows who can see it (public A: **Visible to everyone**). Tap it → choose **Only me** → as B, the list is gone from A's profile, Explore → Lists and B's search; opening A's old share link no longer shows it.
- [ ] Private A: list settings offer **Followers only / Discoverable anonymously / Only me**. Choose Discoverable anonymously: Save is blocked until the box is ticked; **Preview what others will see** shows names and items only.
- [ ] As C (not following A): Explore → **Lists** shows A's list marked **Anonymous** with no name; opening it shows items and ratings but no notes, photos, addresses or A's name. Search finds it by an item name.
- [ ] A switches it back to Only me → C's open page says **This list isn't available** after a refresh, and the old link stays dead even if A turns anonymous on again.

## 6. Recipes
- [ ] Explore → Food → **Recipes** → Add Recipe by typing: it saves.
- [ ] **Scan Recipe** the first time shows **"Scan with AI"** with Continue / Type it in instead.
  - [ ] "Type it in instead" opens an empty recipe.
  - [ ] Continue → pick a recipe photo → the form fills in, and **Public is off** by default.
- [ ] The second scan skips the permission screen.

## 7. Home, navigation, Friends and Explore
- [ ] The tab bar reads **Home · Explore · Lists · Activity · You**, and the app opens on Home.
- [ ] Home: tapping **Coffee** opens Explore with Coffee selected. Switch to Home and back to Explore: Coffee is still selected.
- [ ] Home with location never allowed: **no permission pop-up**; the section is "Popular on Afiyeat" and events show as a single "What's on near you" row.
- [ ] Home as a new account that follows nobody: "From your circle" shows **Find people**, and no empty sections appear.
- [ ] Home search bar → type a restaurant: Places results appear; tap one → it saves to My Restaurants (address and pin show). People and Lists tabs find B and B's lists.
- [ ] Old links: afiyeat.com/foodie opens Explore → Food → Recipes.
- [ ] Activity: B requests to follow private A → A's Activity tab shows a badge; Accept there clears it (and Profile's banner).
- [ ] B adds an item and a comment on a shared list → it appears in A's Activity; tapping it opens that shared list with **Lists** selected in the tab bar, and Back returns to Activity.
- [ ] Lists → Shared → a list → Back returns to Lists → Shared. Friends no longer has a Shared Lists tab.
- [ ] Home → Popular → **See all** opens Explore on **All**.
- [ ] Lists → Shared / Discover tabs show shared lists and other people's lists.
- [ ] Follow B from B's profile; B's places show on the Friends map (Activity → Find people).
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
