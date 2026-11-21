# Item details: production migration plan (two tables)

**Status: proposal for PM approval. Nothing here has been run in production.**

**What it adds:**
- `custom_list_owner_settings`: one row per list, holding that list's field definitions.
- `custom_list_item_owner_values`: one row per item, holding its values.
- 12 helper and validation functions, two triggers, and two owner-only policies.

It changes no existing table, column, policy, function, grant, bucket, Edge Function or Realtime setting.

The SQL is [`db/proposals/lists_v2_owner_fields.sql`](../../../db/proposals/lists_v2_owner_fields.sql), at the commit this plan ships with:
- 15,042 bytes, 274 lines
- md5 `6bda118f34585ccfd449228fa1523b6d`
- paste-check hash `797576852`
- no backticks or `${`; three backslashes (in the date pattern `^\d{4}-\d{2}-\d{2}$`)

## 0. Order

1. **Apply the SQL first.** Older apps never read these tables, so nothing changes for anyone until a build that uses them ships.
2. **Build RC3** from the item-details branch. It finds the tables and shows the fields.
3. **TestFlight**, then the 13-point checklist plus the item-details checks in section 5.
4. **Later, separately:** publish afiyeat.com and the App Store build.

## 1. Before (read-only)

| Step | How | Pass if |
|---|---|---|
| 1.1 Backup | Lovable › Cloud › Export project data. Copy it off-platform to the encrypted Mac folder, as on 2026-11-20, and check it with `check-backup.mjs`. | Archive complete, sha256 recorded |
| 1.2 Prechecks | Run `lists_v2_owner_fields_precheck.sql` with the read-only wording | All 6 rows `ok = true` |
| 1.3 Fingerprint | Run `docs/release/lists-v2/security-fingerprint.sql` | Overall `38a9382489887097807ba8ab4975fdf0` (51 items), the value after the five migrations |
| 1.4 Counts | Run `docs/release/lists-v2/pre-migration-counts.sql` and save the result | Saved for step 3.4 |

If any of these fails, stop. Nothing has been changed yet.

## 2. Apply

- **Mode:** Lovable Build mode, with the standing wording: "Apply this SQL exactly as written, byte for byte… stop and show me the exact error."
- **Paste method:** use the line-break method verified on 2026-11-20 (Shift+Enter between lines). Before sending, compare the text in the chat box with the file's paste-check hash.
- **Why the method matters:** a plain paste doubles every line break. The SQL would still run correctly, but step 3.1 would fail its exact-text check.
- **It's one statement batch.** If Lovable reports any error, stop and report it. Don't retry or alter it.

## 3. After (read-only)

| Step | How | Pass if |
|---|---|---|
| 3.1 Postchecks | Run `lists_v2_owner_fields_postcheck.sql` | All 9 rows `ok = true`, including "applied exactly" (digest `4816778c`) |
| 3.2 Nothing else changed | Run the fingerprint again | Still `38a9382489887097807ba8ab4975fdf0`. The fingerprint doesn't cover the new objects, so any change means an existing rule changed. |
| 3.3 Lists checks | Run `post-migration-checks.sql` | All 10 still true |
| 3.4 No data change | Run the counts again | Every count equal to step 1.4, give or take what people added in between; none lower |
| 3.5 Live app | Open the App Store app and afiyeat.com | Lists, items and photos open as before. Neither app reads the new tables yet. |

## 4. If something is wrong

| Situation | Do this | Data |
|---|---|---|
| Lovable reports an error while applying | Stop and report it. The SQL runs as one batch; check with the precheck whether anything was created. | Nothing to lose; the tables are new |
| A postcheck fails, and nobody has saved details yet (before RC3 ships) | Run `lists_v2_owner_fields_rollback.sql`. With no saved rows it removes exactly what was added. | Nothing to lose |
| A problem after people have saved details | **Park; don't drop.** Run `lists_v2_owner_fields_park.sql`. | Kept in full |

What parking does:
- It moves both tables, with every row, into a private `lv2_parked` schema that no app role can reach.
- It stops signed-in users calling the three functions, and reloads the API schema.
- Every app then behaves exactly as before item details existed. That's tested: the lists, items, editor and saving all work, and no details show.
- To undo it, run `lists_v2_owner_fields_unpark.sql`. It puts everything back unchanged, with its policies, grants and triggers.

Full removal after people have saved details:
- It deletes their saved definitions and values.
- The rollback script refuses while either table has rows, unless the session confirms a backup was taken after the last save (`SET lv2.confirm_delete_saved_details = 'backup-taken'`).
- It needs a fresh export first, and separate PM approval.

Each person can also download their own details at any time through `export_my_list_owner_data()`.

## 5. Acceptance on the phone (RC3)

These run on top of the existing 13-point checklist.

1. **New Coffee Beans list:**
   - The sheet shows Roaster, Roast and Taste profile under Details, with no roast categories.
   - Quick Add asks only for the coffee's name.
2. **Edit details on that coffee:**
   - Fill in Roaster, one of the six roasts, a suggested taste tag and a typed one, then Save.
   - Reopen the item: everything is there. The list row reads "Roaster · Roast".
3. **Item page:** shows only the filled fields. Notes are unchanged.
4. **Hide a field:** in Customize › Fields, hide Roaster. It disappears from the item; show it again and the value comes back.
5. **Existing Wines list:**
   - Use Add Wines details, then set Producer, Vintage and Colour on one wine.
   - Its notes, rating, status and photos are unchanged.
6. **Privacy:** a second account that can see the list sees the items, but none of the details.
7. **Edit Item:** opening it doesn't raise the keyboard; tapping a field does.
8. **Failure path (airplane mode on during Save):**
   - The editor says the item saved but its details didn't, and keeps what you typed.
   - Turn airplane mode off and tap Try saving details again. It saves, and the item isn't duplicated.

## 6. Tested so far (local only)

- **In-process Postgres with every repository migration replayed:** 26 database tests.
  - Prechecks and postchecks, including that the exact-text check catches doubled line breaks.
  - Owner save and reopen, empty fields, unchanged items, validation, hidden values kept, counted delete, export.
  - Follower, stranger and signed-out privacy; discovery and previews never include values.
  - Park and unpark keep every row; the full rollback refuses while rows exist.
- **Lab end-to-end:** the real app against a local copy of the lab data, 26/26. That includes park and unpark while the app is running.
