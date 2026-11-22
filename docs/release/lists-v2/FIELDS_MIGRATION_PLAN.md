# Item details: production migration plan (two tables)

**Status: third candidate (2026-11-21) awaiting PM approval. Nothing here has been run in production.**

**Revisions, 2026-11-21.** Two earlier files are withdrawn. Lovable refused both before running anything; prechecks and the fingerprint afterwards confirmed nothing was created either time.

| File | md5 | Lovable's refusal (UTC) |
|---|---|---|
| First (`9506839`) | `6bda118f34585ccfd449228fa1523b6d` | 2026-11-22 02:43: table grants must come before row-level security and policies |
| Second (`7e0c2a1`) | `c55705346baa874ce5161e7c04c35585` | 2026-11-22 03:27: the migration tool prohibits explicit `BEGIN`/`COMMIT` |

The third candidate differs from the first only in this:
- the table `REVOKE`/`GRANT` pair moved to right after the two tables, before row-level security and the policies;
- no transaction statements: Lovable's migration tool supplies the transaction (section 2a);
- the header says what the file is now.

Every table definition, function body, policy expression and permission is unchanged: the same 35 statements, in the same order apart from the two moved grants. The postcheck's exact-text digest is still `4816778c` (verified on PGlite and, through Drizzle's own runner, on Postgres 16; not assumed).

**What it adds:**
- `custom_list_owner_settings`: one row per list, holding that list's field definitions.
- `custom_list_item_owner_values`: one row per item, holding its values.
- 12 helper and validation functions, two triggers, and two owner-only policies.

It changes no existing table, column, policy, function, grant, bucket, Edge Function or Realtime setting.

The SQL is [`db/proposals/lists_v2_owner_fields.sql`](../../../db/proposals/lists_v2_owner_fields.sql), at the commit this plan ships with:
- 15,738 bytes, 285 lines (ends with one line break)
- md5 `6a743fdaa98c94b1f11006665f74363f`
- the text pasted (the file without its last line break): 15,737 characters, sha256 `9d4fde3c558f15c96fbd710a7a61b5444ff94c2b1e383fec034b127f21a53cb4`
- no backticks, `${`, tabs or non-ASCII characters; three backslashes (in the date pattern `^\d{4}-\d{2}-\d{2}$`)
- no `BEGIN`, `COMMIT`, `ROLLBACK` or other transaction statements (the words appear only inside function bodies, as PL/pgSQL `BEGIN … END`, and in the header's mention of the rollback file)

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
- **Check before sending (reproducible):** run this in the browser console on the Lovable page. It must print `15737 9d4fde3c558f15c96fbd710a7a61b5444ff94c2b1e383fec034b127f21a53cb4`. Anything else: clear the box and type it again; don't send.
  ```js
  (async () => { const el = document.querySelector('div.ProseMirror[contenteditable="true"][aria-label="Ask Lovable..."]').cloneNode(true);
    el.querySelectorAll('br.ProseMirror-trailingBreak').forEach((b) => b.remove()); el.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
    const t = [...el.querySelectorAll(':scope > p')].map((p) => p.textContent).join('\n\n'); const sql = t.slice(t.indexOf('-- ====='));
    const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sql)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    console.log(sql.length, h); })();
  ```
  The same method matched exactly on 2026-11-22 for the read-only queries and for both earlier files (15,041 and 15,489 characters).
- **If Lovable refuses or reports any error,** stop and report it. Nothing was kept (section 2a), but check with the precheck and fingerprint. Don't retry or alter it, and don't use the SQL editor, "Resolve migration ordering", "Apply migration unchanged" or "Fix all" instead.
- **Pending migrations:** Lovable applies every pending migration in the same run. Before applying, ask it (Chat mode, read-only) whether any other migration is pending; if one is, stop.

### 2a. Where the one-transaction guarantee comes from

- **Lovable's documentation** ([Database](https://docs.lovable.dev/features/database), read 2026-11-21): Lovable applies migrations with Drizzle; if one statement fails it discards every change from that run and applies nothing; migration SQL must not contain `BEGIN`, `COMMIT` or `ROLLBACK`. It also warns that the older `supabase/migrations/` setup behaves differently, and that its SQL editor does not guarantee one transaction.
- **This project is on the Drizzle setup.** On `main`, `drizzle.config.ts` points drizzle-kit at `LOVABLE_DB_MIGRATION_URL`, and Lovable committed the five Lists V2 migrations of 2026-11-20 as `drizzle/migrations/0006`–`0010` with journal entries. The production backup of 2026-11-22 includes the `drizzle` schema.
- **Lovable's own answer** (Chat mode, 2026-11-22 03:39 UTC): the tool is `lov_database--migration`; it writes the file and journal entry and applies pending migrations through drizzle-kit in one transaction; it doesn't split statements into separately committed batches; it refuses `BEGIN`/`COMMIT` because it already wraps the run.
- **The runner's code.** `main` pins drizzle-kit 0.31.11, drizzle-orm 0.45.3 and the `postgres` driver 3.4.9 (no `pg`). With those, `drizzle-kit migrate` uses drizzle-orm's postgres-js migrator, which runs `begin`, then each migration file as one query (Lovable's files have no statement breakpoints), then the journal insert, then `commit`; any error rolls back.
- **Checked on a real server** with exactly those versions (`scripts/lab/owner-fields-drizzle.mjs`, section 6). The server log shows that sequence.
- **Not verifiable from here:** Lovable's hosted runner itself. The guarantee rests on its documentation, its answer and the pinned versions matching what it runs.

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

- **In-process Postgres with every repository migration replayed:** 30 database tests (2026-11-21, third candidate), applying the file the way the runner does (one transaction around the whole file).
  - Prechecks and postchecks, including that the exact-text check catches doubled line breaks.
  - No transaction statements; grants right after the tables and before row-level security. A failure injected after each of the 35 statements leaves no table, function, policy or trigger behind, and the prechecks pass again. A real error (an unknown role in the grant) rolls back too. Control: a `COMMIT` embedded after the grants does leave the tables behind.
  - Owner save and reopen, empty fields, unchanged items, validation, hidden values kept, counted delete, export.
  - Follower, stranger and signed-out privacy; discovery and previews never include values.
  - Park and unpark keep every row; the full rollback refuses while rows exist.
- **Drizzle's own runner on a throwaway Postgres 16 server** (`scripts/lab/owner-fields-drizzle.mjs`, 2026-11-21), with drizzle-kit 0.31.11, drizzle-orm 0.45.3 and `postgres` 3.4.9, a journal like Lovable's, and `drizzle-kit migrate`:
  - The server log shows: `begin`, the whole file as one query, the journal insert, `commit`.
  - Paused right after the table grants, and again after the last statement, a second session sees neither table (anon or signed in) and no journal row.
  - A failure injected after each of the 35 statements: 35/35 rolled back, leaving no table, function, policy, trigger or journal row. The same right after the grants, watched from a second session.
  - Successful runs pass all nine postchecks, digest `4816778c` included; anon is refused.
  - Control: a `COMMIT` embedded after the grants, then a failure, leaves 9 objects behind, so the check can tell.
  - It replaces `owner-fields-visibility.sh`, which used `psql` rather than the real runner.
- **Lab end-to-end:** the real app against a local copy of the lab data, 26/26, on the first file. That includes park and unpark while the app is running. Not rerun for the revision: no definition changed.
