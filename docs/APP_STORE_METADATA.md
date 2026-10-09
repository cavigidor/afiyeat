# App Store listing: copy-paste text

Everything to enter in **App Store Connect → Afiyeat → App Information** and **→ 1.0 Prepare for Submission**. Character limits are Apple's; each count below has been checked.

Rules this text follows:
- It describes only what the app does today. No News, no imports, no widget.
- No competitor or other-app names anywhere (Apple guideline 2.3.7).
- No prices or "free forever" promises.

---

## App Information (set once)

| Field | Value |
|---|---|
| Name (30) | `Afiyeat: Food Lists & Recipes` (29) |
| Subtitle (30) | `Save restaurants with friends` (29) |
| Primary category | Food & Drink |
| Secondary category | Lifestyle |
| Content rights | "Does your app contain, show, or access third-party content?" **Yes**, then confirm you have the necessary rights. The app shows Apple Maps data (under the Apple Developer Program agreement), Ticketmaster events (under their API terms) and user posts (under the Terms of Service). |
| Age rating | See "Age rating answers" below. |
| Privacy Policy URL | `https://afiyeat.com/privacy` |
| User Privacy Choices URL (optional) | `https://afiyeat.com/support` |

## Version 1.0 page

| Field | Value |
|---|---|
| Support URL | `https://afiyeat.com/support` |
| Marketing URL | `https://afiyeat.com` |
| Copyright | `2026 <legal name exactly as on your Apple Developer account>` |
| Version | `1.0` (matches Xcode MARKETING_VERSION) |
| Keywords (100) | `restaurant,map,places,friends,foodie,wishlist,dining,cafe,coffee,bucket list,brunch,cookbook,tracker` (exactly 100) |

Keywords don't repeat words already in the name ("food", "lists", "recipes"), because Apple already indexes the name.

### Promotional text (170, can change any time without review)

```
Save every restaurant you want to try, rate the ones you love, and see your food life on a map. Share lists with friends and invite them to build theirs.
```
(153 characters)

### Description (4000)

```
Afiyeat is your food journey, all in one place.

Keep track of every restaurant you want to try and every one you've loved, see them on your own map, and swap recommendations with the people whose taste you actually trust.

SAVE AND RATE RESTAURANTS
• Search for any place and save it in seconds
• Keep a To Go list and a Been There list
• Rate places out of 10, note the price, and add your own notes and photos
• Organise with your own types: date night, brunch, cheap eats, anything you like

YOUR FOOD MAP
• See every place you've saved on a map
• Find what's near you with one tap
• Get directions in Apple Maps or Google Maps

LISTS FOR EVERYTHING ELSE
• Make lists for coffee shops, wines, books, movies, shows, concerts and more
• Presets set up each list for you, with the right fields and statuses
• Track progress your way, like Want to Read, Reading and Read

RECIPES
• Save your recipes with ingredients, steps, times and servings
• Scan a printed or handwritten recipe with your camera to fill it in for you
• Keep recipes private, or share them

FOOD IS BETTER WITH FRIENDS
• Follow friends and see where they love to eat
• Build a shared list with a friend for the places you want to try together
• Explore the places people have been, with their ratings
• Share any place, list or recipe with a link, even with friends who don't have the app yet
• Invite friends and collect stamps in your Afiyeat Passport

YOUR PRIVACY
• Make your profile private so only people you approve can see it
• Block or report anyone, any time
• No ads, no tracking
• Delete your account and data from the app whenever you want

"Afiyet olsun" is what you say in Turkish at the start of a meal: may it bring you health. Afiyeat is built in that spirit, for sharing good food with good people.

Questions or feedback: support@afiyeat.com
```

### What's New (first version)

```
Welcome to Afiyeat!
```

---

## Screenshots

Apple needs **at least one 6.9-inch iPhone set**, portrait, **1320 × 2868** (or 1290 × 2796). Apple scales it down for smaller iPhones. Up to 10 images; 5–6 is plenty. The app is iPhone-only, so no iPad screenshots are needed.

**How to take them:** run the app in the Xcode Simulator on an **iPhone 17 Pro Max**, sign in to the demo account (see APP_REVIEW_NOTES.md) and press **Cmd+S** in the Simulator. The image saves to your Desktop at the right size.

Use the demo account, not your real one, so no real names or private notes appear. Suggested order:
1. **My Restaurants** with a few places, split view of list and map
2. **The map** with coloured type pins
3. **A restaurant's detail** with rating, notes and a photo
4. **My Lists** showing several lists (coffee, books, movies)
5. **A recipe**, plus the Scan Recipe button
6. **Explore** or a **friend's profile**

Optional captions on top ("Every place you want to try", "Your food map", …) can be added in any design tool, at the same pixel size.

App preview videos are optional; skip them for 1.0.

---

## Age rating answers

The questionnaire changes over time, so answer what's on screen truthfully. For Afiyeat today:

- **Violence, sexual content, profanity, horror, drugs, gambling, contests, medical:** None.
  - Alcohol appears only as user lists (e.g. "Wines"), never promoted. If a question asks about alcohol references, choose the lowest frequency option ("Infrequent/Mild").
- **User-generated content: Yes.** Users post places, notes, recipes, lists and photos. Moderated: report, block, a text filter, automatic hiding after repeated reports, and a moderation queue.
- **Social features / messaging: Yes.** Profiles, following, shared lists and comments between two members of a shared list. There's no open chat.
- **Unrestricted web access: No.** Links open specific map/directions pages, not a browser.
- **In-app purchases / gambling / advertising: No.**
- **Age assurance (Declared Age Range): Not used.**

Expected outcome: **13+**, which matches the Terms of Service minimum age. If the questionnaire produces something higher, accept it rather than adjusting answers.
