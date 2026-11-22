# Item details: production migration plan (two tables)

**Status: revised file (2026-11-21) awaiting PM approval. Nothing here has been run in production.**

**Revision 2026-11-21.** The first file (md5 `6bda118f34585ccfd449228fa1523b6d`) is withdrawn. On 2026-11-22 02:43 UTC Lovable refused to apply it, before running anything: its migration rules want table grants before row-level security and policies. Prechecks and the fingerprint afterwards confirmed nothing was created. The revised file differs only in this:
- the table `REVOKE`/`GRANT` pair moved to right after the two tables, before row-level security and the policies;
- the whole file runs in one transaction (`BEGIN;` … `COMMIT;`), so a failure leaves nothing behind and no other session sees the tables before row-level security is on;
- the header says what the file is now.

Every table definition, function body, policy expression and permission is unchanged: the same 35 statements, in the same order apart from the two moved grants. The postcheck's exact-text digest is still `4816778c` (verified on PGlite and on Postgres 16, not assumed).

**What it adds:**
- `custom_list_owner_settings`: one row per list, holding that list's field definitions.
- `custom_list_item_owner_values`: one row per item, holding its values.
- 12 helper and validation functions, two triggers, and two owner-only policies.

It changes no existing table, column, policy, function, grant, bucket, Edge Function or Realtime setting.

The SQL is [`db/proposals/lists_v2_owner_fields.sql`](../../../db/proposals/lists_v2_owner_fields.sql), at the commit this plan ships with:
- 15,490 bytes, 284 lines (ends with one line break)
- md5 `c55705346baa874ce5161e7c04c35585`
- the text pasted (the file without its last line break): 15,489 characters, sha256 `8393b833d08e37c49d019a1ddcb0abc7b50dc3c33a0e505f723be133602c1814`
- no backticks, `${`, tabs or non-ASCII characters; three backslashes (in the date pattern `^\d{4}-\d{2}-\d{2}$`)
- starts with `BEGIN;` (line 35, after the header) and ends with `COMMIT;`

## 0. Order

1. **Apply the SQL first.** Older apps never read these tables, so nothing changes for anyone until a build that uses them ships.
2. **Build RC3** from the item-details branch. It finds the tables and shows the fields.
3. **TestFlight**, then the 13-point checklist plus the item-details checks in section 5.
4. **Later, separately:** publish afiyeat.com and the App Store build.

## 1. Before (read-only)

| Step | How | Pass if |
|---|---|---|
| 1.1 Backup | Lovable › Cloud › Export project data. Copy it off-platform to the encrypted Mac folder, as on 2026-11-20, and check it with `check-backup.mjs`. | Archive complete, sha256 recorded. Done 2026-11-22: `afiyeat_261122.backup`, sha256 `dd89e3aa…e39443`. Take a fresh one if users have written much since. |
| 1.2 Prechecks | Run `lists_v2_owner_fields_precheck.sql` with the read-only wording | All 6 rows `ok = true` |
| 1.3 Fingerprint | Run `docs/release/lists-v2/security-fingerprint.sql` | Overall `38a9382489887097807ba8ab4975fdf0` (51 items), the value after the five migrations |
| 1.4 Counts | Run `docs/release/lists-v2/pre-migration-counts.sql` and save the result | Saved for step 3.4 |

If any of these fails, stop. Nothing has been changed yet.

## 2. Apply

- **Mode:** Lovable Build mode, with the standing wording: "Apply this SQL exactly as written, byte for byte… stop and show me the exact error."
- **Wording:** "Apply this SQL exactly as written, byte for byte, as a database migration. Do not edit, reformat, split, reorder, add to, or "improve" any statement, and do not change any app code. If any statement fails, stop and show me the exact error instead of substituting your own version." Then one blank line, then the file.
- **Paste method:** type it line by line with Shift+Enter between lines (a plain paste doubles every line break). This replaces the old paste-check number, whose method wasn't written down.
- **Check before sending (reproducible):** run this in the browser console on the Lovable page. It must print `15489 8393b833d08e37c49d019a1ddcb0abc7b50dc3c33a0e505f723be133602c1814`. Anything else: clear the box and type it again; don't send.
  ```js
  (async () => { const el = document.querySelector('div.ProseMirror[contenteditable="true"][aria-label="Ask Lovable..."]').cloneNode(true);
    el.querySelectorAll('br.ProseMirror-trailingBreak').forEach((b) => b.remove()); el.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
    const t = [...el.querySelectorAll(':scope > p')].map((p) => p.textContent).join('\n\n'); const sql = t.slice(t.indexOf('-- ====='));
    const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sql)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    console.log(sql.length, h); })();
  ```
  The same method matched exactly on 2026-11-22 for three read-only queries and for the first file (15,041 characters).
- **One transaction.** The file opens its own transaction and commits it at the end. If Lovable reports any error, nothing was kept. Stop and report it. Don't retry or alter it, and don't use the SQL editor, "Resolve migration ordering" or "Fix all" instead.

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
| Lovable reports an error while applying, or refuses | Stop and report it. The file is one transaction, so nothing was kept; confirm with the precheck (all 6 true again) and the fingerprint. | Nothing to lose; the tables are new |
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

- **In-process Postgres with every repository migration replayed:** 30 database tests (2026-11-21, revised file).
  - Prechecks and postchecks, including that the exact-text check catches doubled line breaks.
  - One transaction: `BEGIN` first, `COMMIT` last, grants right after the tables and before row-level security; a failure injected after each of the 36 statements leaves no table, function, policy or trigger behind, and the prechecks pass again; a real error (an unknown role in the grant) rolls back too; it also applies when the tool wraps it in its own transaction.
  - Owner save and reopen, empty fields, unchanged items, validation, hidden values kept, counted delete, export.
  - Follower, stranger and signed-out privacy; discovery and previews never include values.
  - Park and unpark keep every row; the full rollback refuses while rows exist.
- **Two sessions on a throwaway Postgres 16 server** (`scripts/lab/owner-fields-visibility.sh`, 2026-11-21): while the file runs, paused after the table grants and again before `COMMIT`, a second session sees neither table, as anon or signed in. A run that fails after the grants leaves nothing behind. Successful runs pass all nine postchecks, digest included. Without `BEGIN`/`COMMIT` the same script fails: a signed-in session could read the empty table before row-level security was on.
- **Lab end-to-end:** the real app against a local copy of the lab data, 26/26, on the first file. That includes park and unpark while the app is running. Not rerun for the revision: no definition changed.
