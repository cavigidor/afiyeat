# Lists V2 TestFlight acceptance: your real account (about 15 minutes)

**Before you start:**

- The five migrations are applied, and every post-migration check is true.
- You've rotated your Afiyeat password.
- The build is from `release/lists-v2-rc1`.

**How to work through it:**

- Write down anything you change. The export comparison afterwards should show exactly those changes and nothing else.
- Use only your own account. Don't edit anything you'd mind keeping, because these are real changes.

## Expected starting point (from the 2026-11-20 export)

- **Lists:** 2 lists, 7 items each, 14 items in total. Both are set to "Visible to everyone" (profile visibility).
- **My Restaurants:** 188 places, 70 To Go and 118 Been There, with 159 photos. One Been There place has **10 photos**.

## Checks

| # | Do this | Pass if |
|---|---|---|
| 1 | Sign in, then open **Lists** | Both lists show 7 items each. No error appears. |
| 2 | Open each list and tap through every status tab | The tab counts add up to 7. Every item you remember is there. Its notes, rating and status are unchanged. |
| 3 | Open **My Restaurants** | To Go (70) and Been There (118) |
| 4 | Open **Edit** on the Been There place with 10 photos, then close it | All 10 photos load. The 5-photo limit note shows. No photo is removed. |
| 5 | Open Edit on that place again, change nothing, and tap **Save Changes** | It saves, and all 10 photos are still there. The comparison will show that `visited_at` didn't change. |
| 6 | In a list, open an item, use **Edit details** to add a word to its notes, and save | The note is saved. Its status, rating and photos are unchanged. |
| 7 | Use **Quick add** in a list: type a new item name and save it | One new item appears under the current status. |
| 8 | Move that new item to another status, then delete it | It moves and then disappears. Nothing else changes. |
| 9 | Customize a list: hide a field (for example Rating), then show it again | The values come back unchanged. |
| 10 | Add one photo to an item that has fewer than 5, using the iPhone photo picker | The picker lets you choose only up to the remaining slots. The photo uploads and appears. |
| 11 | On a list, change **Who can see it** to Only me, then back to Visible to everyone | Both changes save without an error. |
| 12 | **Privacy:** on a second phone signed in as another account (or ask a friend), open your profile | They see the list while it's set to Visible to everyone. They don't see it while it's set to Only me. |
| 13 | Sign out, then sign back in | Everything above is still there. |

## Afterwards

Export again and compare, as in RELEASE_RUNBOOK section 5. Expected changes, and nothing else:

- the note you edited (step 6)
- the photo you added (step 10)
- `updated_at` values, which the comparison ignores
- the quick-add item, which shouldn't appear at all because you deleted it in step 8
