# Integration, live-backend checks and staging acceptance

Prepared 11 Nov 2026. Covers PR #1, #7, #8, #10, #11, #12, #13 and #14. Nothing here has been merged, deployed or applied, and **no step below writes to production**.

- [1. Branches and stacking](#1-branches-and-stacking)
- [2. Read-only production checks](#2-read-only-production-checks)
- [3. Staging acceptance build](#3-staging-acceptance-build-iphone)
- [4. Migration order](#4-migration-order)

---

## 1. Branches and stacking

### The replacement stack

The reviewed PR branches are left untouched. The replacement branches below are **new branches**, so they need no force-push.

| Replaces | Branch | Its parent | Own commits |
|---|---|---|---|
| — | `stack/base` | `main` 9baf34e | 3 merge commits: PR #1 `9a50224`, PR #12 `24ee55f`, PR #13 `2b779dd` (the real heads) |
| PR #7 | `stack/7-add-item` | `stack/base` | 3 (#7's two + the photo-helper integration) |
| PR #11 | `stack/11-home-add-to-list` | `stack/7-add-item` | 1 |
| PR #8 | `stack/8-lists-discovery` | `stack/11-home-add-to-list` | 3 (incl. the MyLists/docs conflict resolution) |
| PR #10 | `stack/10-discovery-categories` | `stack/8-lists-discovery` | 3 (incl. the Explore conflict resolution #10 documented) |
| PR #14 | `stack/14-photo-records-owner-check` | `stack/10-discovery-categories` | 2 (the fix + a test-fixture commit for #12's policy test) |

How the stack was checked:
- Each branch's parent is an ancestor of it.
- The real heads of PR #1, #12 and #13 are ancestors of the whole stack.
- `stack/base` has exactly the same tree as the earlier `integration/13-storage-security`.
- Each `stack/*` branch has exactly the same tree as its `integration/*` predecessor.
- The `integration/*` branches are kept for reference, but are superseded. They sat on a *simulated* squash, so the real PR heads weren't their ancestors.

Combined checks at `stack/14-photo-records-owner-check`:
- **345/345 tests** (the 335 from before + 10 new).
- Typecheck: 0 errors.
- Lint: 0 errors, 20 warnings (`main` has 23).
- Build: OK.

### Opening the replacement PRs (when approved)

Open each as a draft, with **base = its parent branch**, so each PR shows only its own commits:

```sh
gh pr create --draft --base stack/base --head stack/7-add-item --title "Universal Add Item (replaces #7)"
gh pr create --draft --base stack/7-add-item --head stack/11-home-add-to-list --title "Home Add-to-List (replaces #11)"
gh pr create --draft --base stack/11-home-add-to-list --head stack/8-lists-discovery --title "Community list discovery (replaces #8)"
gh pr create --draft --base stack/8-lists-discovery --head stack/10-discovery-categories --title "Smart discovery categories (replaces #10)"
```

`stack/base` itself is **not** a PR. It stands in for "main after #1, #12 and #13", which merge through their own PRs. #14 is reviewed as its own PR (base `main`).

### Restacking after a squash merge: one command per merge

A squash merge rewrites the merged commits, so everything above them must move. Rebase **only the tip** once, with `--update-refs`, which needs git ≥ 2.38. That carries every intermediate branch along and keeps each parent→child link:

```sh
git fetch origin
# OLD_PARENT = the commit the next PR currently sits on (before the merge)
git rebase --update-refs --onto origin/main <OLD_PARENT> stack/14-photo-records-owner-check
git push --force-with-lease origin stack/7-add-item stack/11-home-add-to-list \
  stack/8-lists-discovery stack/10-discovery-categories stack/14-photo-records-owner-check
```

1. **After #1, #12 and #13 are all squash-merged:**
   - Run the command with `OLD_PARENT = origin/stack/base` as it was before the merges. Note its SHA first.
   - Then retarget the #7 replacement to `main` (`gh pr edit <n> --base main`).
2. **After the #7 replacement is squash-merged:**
   - Run the command with `OLD_PARENT` = the #7 replacement's last commit before the merge.
   - Retarget #11's replacement to `main`.
   - Keep going like this up the stack.
3. **After every restack:** run `npm run typecheck && npm run lint && npm run build && npm test`. Expect 345 tests.
4. **Branch deletion:** don't delete a merged PR's branch before the next PR has been restacked and retargeted.

**Force-push note.** Steps 1–2 force-push the replacement branches. Those are new branches that no reviewer has approved commits on. It still needs the PM's go-ahead at that time. If no force-push is wanted at all, push each restack to a new name (`stack-v2/…`) and open new PRs instead.

**Don't** rebase each branch independently onto the same base (`git rebase --onto main <old base> <branch>` for every branch). Each branch then gets its own private copy of its parents' commits, and the stack falls apart. In the rehearsal, #8' and #10' lost their parent and would have shown 7 and 10 commits instead of 3.

**Rehearsed.** In a separate clone, I simulated GitHub squash merges of #1, #12 and #13 onto `main`, ran the single restack, then simulated #7''s squash and ran the second restack. Every parent→child link held, the final tree was identical, and the full checks passed (335/335, before #14 existed).

**Other open PRs.**
- #2 merges cleanly with the stack.
- #9 conflicts only in `docs/PROJECT_MAP.md`.
- If either lands on `main` first, the same restack command applies; resolve any conflict once, at the tip.

---

## 2. Read-only production checks

**How to run them in Lovable.** There's no Supabase dashboard for this project, so ask Lovable's agent to run each query as-is. Paste this sentence above each query:

> Run this read-only SQL query against the Cloud database exactly as written and show me the full result table. It only reads. Do not create a migration, do not change anything, and do not "fix" anything it shows.

- Every query below is a single `SELECT`/`WITH` statement starting with `-- READ ONLY`.
- If Lovable offers an "Apply"/migration button, or wants to change the query, **decline**.
- Copy the result tables back for review.

### 0. Who the query runs as

```sql
-- READ ONLY
SELECT current_user, session_user, current_setting('server_version') AS postgres_version, now() AS checked_at;
```

**Expected:** `postgres`, `supabase_admin` or another admin role. If it says `authenticated` or `anon`, stop. Row-level security would hide rows, and every count below would be too low.

### 1. Can signed-in users choose a photo record's id? (PR #12)

PR #12 inserts each photo record with an id chosen by the app. That's what makes retries safe. If the database doesn't allow it, every photo add would be refused and reported as failed.

```sql
-- READ ONLY
SELECT c.table_name,
       has_table_privilege('authenticated', format('public.%I', c.table_name), 'INSERT') AS can_insert,
       has_column_privilege('authenticated', format('public.%I', c.table_name), 'id', 'INSERT') AS can_set_id,
       c.data_type, c.column_default, c.is_identity, c.is_generated,
       (SELECT string_agg(t.tgname, ', ') FROM pg_trigger t
         WHERE t.tgrelid = format('public.%I', c.table_name)::regclass AND NOT t.tgisinternal) AS triggers
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN ('restaurant_images', 'custom_list_item_images')
  AND c.column_name = 'id'
ORDER BY c.table_name;
```

**Expected:** 2 rows, each with:
- `can_insert = true` and `can_set_id = true`;
- `data_type = uuid`, `column_default = gen_random_uuid()`;
- `is_identity = NO`, `is_generated = NEVER`;
- `triggers` empty.

**Blocks merging PR #12** if `can_set_id` is false, or a trigger rewrites `id`.

### 2. Bistro Monadnock's photos

2a: the photo records and whether each file exists:

```sql
-- READ ONLY
WITH rows AS (
  SELECT ri.id, r.name AS place, r.user_id AS place_owner, ri.user_id AS uploader, ri.image_url, ri.created_at,
    CASE
      WHEN ri.image_url ~ '/storage/v1/object/(public|sign|authenticated)/restaurant-images/' THEN 'url'
      WHEN ri.image_url ~ '^[A-Za-z][A-Za-z0-9+.-]*:' OR left(ri.image_url, 1) = '/' THEN 'external'
      ELSE 'bare_path'
    END AS fmt,
    CASE
      WHEN ri.image_url ~ '/storage/v1/object/(public|sign|authenticated)/restaurant-images/'
        THEN regexp_replace(split_part(ri.image_url, '?', 1), '^.*/storage/v1/object/(public|sign|authenticated)/restaurant-images/', '')
      WHEN ri.image_url !~ '^[A-Za-z][A-Za-z0-9+.-]*:' AND left(ri.image_url, 1) <> '/'
        THEN regexp_replace(ri.image_url, '^restaurant-images/', '')
    END AS object_path
  FROM public.restaurant_images ri
  JOIN public.restaurants r ON r.id = ri.restaurant_id
  WHERE r.name ILIKE 'Bistro Monadnock%'
)
SELECT rows.id, place, place_owner, fmt, object_path, rows.created_at,
       o.id IS NOT NULL AS file_exists,
       o.metadata ->> 'mimetype' AS mimetype,
       (o.metadata ->> 'size')::bigint AS bytes,
       CASE
         WHEN fmt = 'external' THEN 'external'
         WHEN o.id IS NULL THEN 'missing_object'
         WHEN split_part(object_path, '/', 1) <> uploader::text THEN 'file_in_other_users_folder'
         WHEN uploader <> place_owner THEN 'attached_by_someone_else'
         WHEN fmt = 'bare_path' THEN 'ok_bare_path'
         ELSE 'ok'
       END AS status
FROM rows
LEFT JOIN storage.objects o ON o.bucket_id = 'restaurant-images' AND o.name = rows.object_path
ORDER BY place_owner, rows.created_at;
```

**Expected:**
- 2 rows for the place in the screenshot (the carousel showed 2 dots).
- Both `status = ok_bare_path` (added from Edit) or `ok`.
- `file_exists = true`, `mimetype = image/jpeg`, and `bytes` > 0.

A different `place_owner` means another account also has a place of that name.
- `ok_bare_path`: displays once PR #12 ships, with no data change.
- `missing_object`: that photo can't be recovered.

2b: every file in that place's folder, and whether a record points at it:

```sql
-- READ ONLY
SELECT r.user_id AS place_owner, o.name, o.created_at, o.metadata ->> 'mimetype' AS mimetype,
       (o.metadata ->> 'size')::bigint AS bytes,
       EXISTS (SELECT 1 FROM public.restaurant_images ri
               WHERE ri.restaurant_id = r.id
                 AND (ri.image_url = o.name OR split_part(ri.image_url, '?', 1) LIKE '%/restaurant-images/' || o.name)) AS has_record
FROM public.restaurants r
JOIN storage.objects o ON o.bucket_id = 'restaurant-images'
                      AND o.name LIKE r.user_id::text || '/' || r.id::text || '/%'
WHERE r.name ILIKE 'Bistro Monadnock%'
ORDER BY o.created_at;
```

**Expected:** the same files as 2a, all `has_record = true`. A file with `has_record = false` was uploaded but never linked. Don't delete it; it can be re-linked after review (`docs/LISTING_PHOTOS.md`).

### 3. Buckets, broken records and orphan files

3a: buckets:

```sql
-- READ ONLY
SELECT id, public, file_size_limit, allowed_mime_types, created_at
FROM storage.buckets
WHERE id IN ('restaurant-images', 'custom-list-images')
ORDER BY id;
```

**Expected:** 2 rows.
- `restaurant-images`: `public = false`, `file_size_limit = 8388608`, mime types jpeg/png/gif/webp.
- `custom-list-images`: `public = false`. **No migration in the repo creates this bucket**, so a missing row means custom-list photos can't upload at all.
- Note both rows' settings; staging must copy them.

3b: every photo record, by status:

```sql
-- READ ONLY
WITH recs AS (
  SELECT 'restaurant-images'::text AS bucket, ri.user_id AS uploader, r.user_id AS parent_owner, ri.image_url
  FROM public.restaurant_images ri LEFT JOIN public.restaurants r ON r.id = ri.restaurant_id
  UNION ALL
  SELECT 'custom-list-images', ci.user_id, i.user_id, ci.image_url
  FROM public.custom_list_item_images ci LEFT JOIN public.custom_list_items i ON i.id = ci.item_id
), parsed AS (
  SELECT recs.*,
    CASE
      WHEN image_url ~ ('/storage/v1/object/(public|sign|authenticated)/' || bucket || '/')
        THEN regexp_replace(split_part(image_url, '?', 1), ('^.*/storage/v1/object/(public|sign|authenticated)/' || bucket || '/'), '')
      WHEN image_url ~ '^[A-Za-z][A-Za-z0-9+.-]*:' OR left(image_url, 1) = '/' THEN NULL
      ELSE regexp_replace(image_url, ('^' || bucket || '/'), '')
    END AS object_path
  FROM recs
)
SELECT p.bucket,
  CASE
    WHEN p.parent_owner IS NULL THEN 'parent_missing'
    WHEN p.object_path IS NULL THEN 'external_or_other_bucket'
    WHEN o.id IS NULL THEN 'missing_object'
    WHEN split_part(p.object_path, '/', 1) <> p.uploader::text THEN 'file_in_other_users_folder'
    WHEN p.uploader <> p.parent_owner THEN 'attached_to_someone_elses_item'
    WHEN p.image_url !~ '^[A-Za-z][A-Za-z0-9+.-]*:' THEN 'ok_bare_path'
    ELSE 'ok'
  END AS status,
  count(*) AS records
FROM parsed p
LEFT JOIN storage.objects o ON o.bucket_id = p.bucket AND o.name = p.object_path
GROUP BY 1, 2
ORDER BY 1, 2;
```

**Expected:** only `ok` and `ok_bare_path`.

| Status | Meaning |
|---|---|
| `ok`, `ok_bare_path` | Display correctly once PR #12 ships. |
| `missing_object` | The photo isn't recoverable; it shows as "Photo unavailable". |
| `file_in_other_users_folder` | The #13 gap was used. |
| `attached_to_someone_elses_item` | The #14 gap was used. |

Any non-ok count is a data decision for the PM. Nothing gets deleted automatically.

3c: files with no record (orphans):

```sql
-- READ ONLY
SELECT o.bucket_id,
       array_length(string_to_array(o.name, '/'), 1) AS path_parts,
       count(*) AS files, min(o.created_at) AS oldest, max(o.created_at) AS newest
FROM storage.objects o
WHERE o.bucket_id IN ('restaurant-images', 'custom-list-images')
  AND NOT EXISTS (SELECT 1 FROM public.restaurant_images ri
                  WHERE o.bucket_id = 'restaurant-images'
                    AND (ri.image_url = o.name OR split_part(ri.image_url, '?', 1) LIKE '%/restaurant-images/' || o.name))
  AND NOT EXISTS (SELECT 1 FROM public.custom_list_item_images ci
                  WHERE o.bucket_id = 'custom-list-images'
                    AND (ci.image_url = o.name OR split_part(ci.image_url, '?', 1) LIKE '%/custom-list-images/' || o.name))
  AND NOT EXISTS (SELECT 1 FROM public.recipes rc
                  WHERE rc.image_url IS NOT NULL AND split_part(rc.image_url, '?', 1) LIKE '%' || o.name)
GROUP BY 1, 2
ORDER BY 1, 2;
```

**Expected:** no rows, or a few old ones. `path_parts = 3` means a listing photo; 2 means a recipe image. A small number is normal: these are uploads whose record failed before PR #12. Keep them for review.

### 4. Live policies match the repository

The pending migrations replace policies **by name** (`DROP POLICY IF EXISTS "<name>"`). If production's name differs, the old permissive policy silently stays alongside the new one. Postgres ORs permissive policies together, so the fix would do nothing. These checks have to pass before any migration is applied.

4a: storage upload policies:

```sql
-- READ ONLY
SELECT policyname, cmd, roles, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd IN ('INSERT', 'ALL')
ORDER BY policyname;
```

**Expected:** exactly 2 rows.

| policyname | cmd | roles | with_check |
|---|---|---|---|
| Authenticated users can upload custom list images | INSERT | {public} | `((bucket_id = 'custom-list-images'::text) AND (auth.uid() IS NOT NULL))` |
| Users can upload to own folder | INSERT | {authenticated} | `((bucket_id = 'restaurant-images'::text) AND ((auth.uid())::text = (storage.foldername(name))[1]))` |

Any other INSERT/ALL policy covering these buckets means #13 wouldn't close the gap. Report it.

4b: write policies on the photo and list-item tables:

```sql
-- READ ONLY
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('restaurant_images', 'custom_list_item_images', 'custom_list_items')
  AND cmd IN ('INSERT', 'UPDATE', 'ALL')
ORDER BY tablename, policyname;
```

**Expected:** exactly 4 rows.

| table | policy | expression |
|---|---|---|
| `custom_list_item_images` | "Users can insert their own custom list item images" (INSERT) | `with_check (auth.uid() = user_id)` |
| `custom_list_items` | "Users can insert their own custom list items" (INSERT) | `with_check (auth.uid() = user_id)` |
| `custom_list_items` | "Users can update their own custom list items" (UPDATE) | `qual (auth.uid() = user_id)` |
| `restaurant_images` | "Users can insert their own images" (INSERT) | `with_check (auth.uid() = user_id)` |

4c: every policy on the affected tables, by name, against the repository (`main`):

```sql
-- READ ONLY
WITH expected(schemaname, tablename, policyname, cmd) AS (VALUES
    ('public', 'content_reports', 'Moderators can resolve reports', 'UPDATE'),
    ('public', 'content_reports', 'Moderators can view all reports', 'SELECT'),
    ('public', 'content_reports', 'Users can file reports', 'INSERT'),
    ('public', 'content_reports', 'Users can view their own reports', 'SELECT'),
    ('public', 'custom_list_item_images', 'Users can delete their own custom list item images', 'DELETE'),
    ('public', 'custom_list_item_images', 'Users can insert their own custom list item images', 'INSERT'),
    ('public', 'custom_list_item_images', 'Users can view custom list item images of people they follow', 'SELECT'),
    ('public', 'custom_list_item_images', 'Users can view custom list item images of public profiles', 'SELECT'),
    ('public', 'custom_list_item_images', 'Users can view their own custom list item images', 'SELECT'),
    ('public', 'custom_list_items', 'Blocked users cannot view custom list items', 'SELECT'),
    ('public', 'custom_list_items', 'Hidden list items are not shown', 'SELECT'),
    ('public', 'custom_list_items', 'Users can delete their own custom list items', 'DELETE'),
    ('public', 'custom_list_items', 'Users can insert their own custom list items', 'INSERT'),
    ('public', 'custom_list_items', 'Users can update their own custom list items', 'UPDATE'),
    ('public', 'custom_list_items', 'Users can view custom list items of people they follow', 'SELECT'),
    ('public', 'custom_list_items', 'Users can view custom list items of public profiles', 'SELECT'),
    ('public', 'custom_list_items', 'Users can view their own custom list items', 'SELECT'),
    ('public', 'custom_list_statuses', 'Users can delete their own list statuses', 'DELETE'),
    ('public', 'custom_list_statuses', 'Users can insert their own list statuses', 'INSERT'),
    ('public', 'custom_list_statuses', 'Users can update their own list statuses', 'UPDATE'),
    ('public', 'custom_list_statuses', 'Users can view list statuses of people they follow', 'SELECT'),
    ('public', 'custom_list_statuses', 'Users can view list statuses of public profiles', 'SELECT'),
    ('public', 'custom_list_statuses', 'Users can view their own list statuses', 'SELECT'),
    ('public', 'custom_list_types', 'Users can delete their own list types', 'DELETE'),
    ('public', 'custom_list_types', 'Users can insert their own list types', 'INSERT'),
    ('public', 'custom_list_types', 'Users can update their own list types', 'UPDATE'),
    ('public', 'custom_list_types', 'Users can view custom list types of people they follow', 'SELECT'),
    ('public', 'custom_list_types', 'Users can view custom list types of public profiles', 'SELECT'),
    ('public', 'custom_list_types', 'Users can view list types of people they follow', 'SELECT'),
    ('public', 'custom_list_types', 'Users can view list types of public profiles', 'SELECT'),
    ('public', 'custom_list_types', 'Users can view their own list types', 'SELECT'),
    ('public', 'custom_lists', 'Blocked users cannot view custom lists', 'SELECT'),
    ('public', 'custom_lists', 'Hidden lists are not shown', 'SELECT'),
    ('public', 'custom_lists', 'Users can delete their own custom lists', 'DELETE'),
    ('public', 'custom_lists', 'Users can insert their own custom lists', 'INSERT'),
    ('public', 'custom_lists', 'Users can update their own custom lists', 'UPDATE'),
    ('public', 'custom_lists', 'Users can view custom lists of people they follow', 'SELECT'),
    ('public', 'custom_lists', 'Users can view custom lists of public profiles', 'SELECT'),
    ('public', 'custom_lists', 'Users can view their own custom lists', 'SELECT'),
    ('public', 'restaurant_images', 'Users can delete their own images', 'DELETE'),
    ('public', 'restaurant_images', 'Users can insert their own images', 'INSERT'),
    ('public', 'restaurant_images', 'Users can view images from followed users', 'SELECT'),
    ('public', 'restaurant_images', 'Users can view own restaurant images', 'SELECT'),
    ('public', 'restaurants', 'Blocked users cannot view restaurants', 'SELECT'),
    ('public', 'restaurants', 'Hidden restaurants are not shown', 'SELECT'),
    ('public', 'restaurants', 'Users can delete their own restaurants', 'DELETE'),
    ('public', 'restaurants', 'Users can insert their own restaurants', 'INSERT'),
    ('public', 'restaurants', 'Users can update their own restaurants', 'UPDATE'),
    ('public', 'restaurants', 'Users can view own restaurants', 'SELECT'),
    ('public', 'restaurants', 'Users can view restaurants of people they follow', 'SELECT'),
    ('public', 'restaurants', 'Users can view restaurants of public profiles', 'SELECT'),
    ('storage', 'objects', 'Authenticated users can upload custom list images', 'INSERT'),
    ('storage', 'objects', 'Users can delete their own custom list images', 'DELETE'),
    ('storage', 'objects', 'Users can delete their own images', 'DELETE'),
    ('storage', 'objects', 'Users can upload to own folder', 'INSERT'),
    ('storage', 'objects', 'Users can view images from followed users', 'SELECT'),
    ('storage', 'objects', 'Users can view own images', 'SELECT'),
    ('storage', 'objects', 'Users can view their own custom list images', 'SELECT')
), scope AS (SELECT DISTINCT schemaname, tablename FROM expected)
SELECT coalesce(e.schemaname, p.schemaname) AS schema_name,
       coalesce(e.tablename, p.tablename) AS table_name,
       coalesce(e.policyname, p.policyname) AS policy_name,
       CASE WHEN p.policyname IS NULL THEN 'MISSING in production'
            WHEN e.policyname IS NULL THEN 'EXTRA in production (not in repo)'
            ELSE 'DIFFERENT command: repo ' || e.cmd || ', production ' || p.cmd END AS problem
FROM expected e
FULL JOIN (SELECT pp.* FROM pg_policies pp JOIN scope s USING (schemaname, tablename)) p
  ON p.schemaname = e.schemaname AND p.tablename = e.tablename AND p.policyname = e.policyname
WHERE p.policyname IS NULL OR e.policyname IS NULL OR p.cmd <> e.cmd
ORDER BY 1, 2, 3;
```

**Expected: no rows.** Any row is drift between production and the repository. Resolve it before applying migrations.

### 5. Do the pending migrations fit production's actual history?

Production's migration history doesn't match the repo's file names one-to-one:
- Lovable records the migrations it generates (UUID-named files) in `supabase_migrations.schema_migrations`.
- The hand-written ones were pasted in.
- The repo's `drizzle/` folder records six of them.

So version numbers alone don't prove anything. These checks look at the history **and** at the schema objects the pending migrations need.

5a: which history tables exist:

```sql
-- READ ONLY
SELECT to_regclass('supabase_migrations.schema_migrations') AS supabase_history,
       to_regclass('drizzle.__drizzle_migrations') AS drizzle_history;
```

5b: production history against the repository's 81 migrations (skip it if `supabase_history` is null):

```sql
-- READ ONLY
WITH repo(version) AS (VALUES
    ('20251206184716'), ('20251206203301'), ('20251206213347'), ('20251206215303'), ('20251207033157'), 
    ('20260126031902'), ('20260128044934'), ('20260128045144'), ('20260129034326'), ('20260129140105'), 
    ('20260129141135'), ('20260130031217'), ('20260228223319'), ('20260228224430'), ('20260308184912'), 
    ('20260606173213'), ('20260606174334'), ('20260606181539'), ('20260609022202'), ('20260616193554'), 
    ('20260713162528'), ('20260714020628'), ('20260714020715'), ('20260714024532'), ('20260714030126'), 
    ('20260714030410'), ('20260715161304'), ('20260716025851'), ('20260716031105'), ('20260717021922'), 
    ('20260717030909'), ('20260730143519'), ('20260730145344'), ('20260730154218'), ('20260730155344'), 
    ('20260730160211'), ('20260730205415'), ('20260730211925'), ('20260730211950'), ('20260730220000'), 
    ('20260730221145'), ('20260731000000'), ('20260807144946'), ('20260814210336'), ('20260814210346'), 
    ('20260814220523'), ('20260814221733'), ('20260814234713'), ('20260815152925'), ('20260816120000'), 
    ('20260816211302'), ('20260817120000'), ('20260819120000'), ('20260819205436'), ('20260819205456'), 
    ('20260901001332'), ('20260910013333'), ('20260910020000'), ('20260920120000'), ('20260920130000'), 
    ('20260920140000'), ('20260921012415'), ('20260921012441'), ('20260921012558'), ('20260921012701'), 
    ('20260921013149'), ('20260922120000'), ('20260923022414'), ('20260930120000'), ('20261004120000'), 
    ('20261004121000'), ('20261004122000'), ('20261004123000'), ('20261008120000'), ('20261008130000'), 
    ('20261008140000'), ('20261010120000')
), prod AS (SELECT version FROM supabase_migrations.schema_migrations)
SELECT coalesce(repo.version, prod.version) AS version,
       CASE WHEN prod.version IS NULL THEN 'in repo, not in production history'
            ELSE 'in production history, NOT in repo' END AS status
FROM repo FULL JOIN prod ON prod.version = repo.version
WHERE repo.version IS NULL OR prod.version IS NULL
ORDER BY 1;
```

**Expected:**
- **No "NOT in repo" rows.** Any such row is a change made in Lovable that never reached GitHub. Stop and investigate.
- "In repo, not in production history" rows should only be the hand-written files. Those were applied by pasting, so they're tracked differently:

  - `20260716031105_add_mentioned_restaurants_to_news_items`
  - `20260717021922_fix_get_explore_places_numeric_types`
  - `20260717030909_warmer_notification_copy`
  - `20260730143519_singularize_and_merge_folder_types`
  - `20260730154218_raise_restaurant_images_bucket_size_limit`
  - `20260730155344_fix_device_token_reassignment_rls`
  - `20260730205415_seed_default_restaurant_types`
  - `20260730220000_explore_include_no_place_id_and_hide_private_names`
  - `20260731000000_add_folder_sort_order`
  - `20260816120000_behavior_notifications`
  - `20260817120000_avatar_presets`
  - `20260819120000_good_morning_treat`
  - `20260901001332_custom_list_statuses`
  - `20260910020000_multi_tag_types_and_folders`
  - `20260920120000_ugc_safety_report_and_block`
  - `20260920130000_moderation_roles_and_queue`
  - `20260920140000_afiyeat_passport_referrals`
  - `20260922120000_shared_content_preview`
  - `20260930120000_referral_hardening_and_history`
  - `20261004120000_explore_privacy_and_blocks`
  - `20261004121000_account_deletion_cleanup_log`
  - `20261004122000_otp_atomic_operations`
  - `20261004123000_ai_scan_daily_limit`
  - `20261008120000_apple_places_foundation`
  - `20261008130000_apple_places_reconcile`
  - `20261008140000_apple_places_in_explore_and_previews`
  - `20261010120000_moderation_enforcement`

A UUID-named version in that list was never applied.

5c: the drizzle record (skip it if `drizzle_history` is null):

```sql
-- READ ONLY
WITH repo(idx, tag, hash, created_at) AS (VALUES
    (0, '0000_explore_privacy_blocks_cleanup_otp_atomic_ai_scan_limit', 'c7d1a750d38b0f3d04da68c7025f4ef1980e792d409b116fbe6087e01b933834', 1791341084663),
    (1, '0001_referral_hardening_and_history', 'b92e0f69b19d17e272a74996cb459e7fe64057da7842f3ea3ff8e0349c604ac3', 1791341570724),
    (2, '0002_apple_places_integration', 'f9e16fda396a856a6af6c1df015a2de4440ac1fa102b672e2eec95355f178436', 1791423753545),
    (3, '0003_apple_places_reconcile', 'a2a5dc3d3dae6889559bf32222a1ec99f34f45d89a7ba96a61e46c9b2aef065e', 1791425330760),
    (4, '0004_apple_explore_and_share_previews', '70448541130b0bc74c329d92e4911b3152cd576c7dce714c9c7af4181baff433', 1791426663655),
    (5, '0005_moderation_enforcement', '583115bfcad2b1591f7acb2c4ba9c286f13cd88ce32388934d2fbd5c82583d74', 1791429030848)
)
SELECT repo.idx, repo.tag, d.id IS NOT NULL AS applied, d.created_at = repo.created_at AS same_timestamp
FROM repo LEFT JOIN drizzle.__drizzle_migrations d ON d.hash = repo.hash
ORDER BY repo.idx;
```

**Expected:** 6 rows, all `applied = true` and `same_timestamp = true`. The hashes are SHA-256 of the files in `drizzle/migrations/`.

5d: what the pending migrations need, and that none of them is applied yet:

```sql
-- READ ONLY
SELECT check_name, expected, actual, actual IS NOT DISTINCT FROM expected AS ok FROM (VALUES
  ('Latest applied: moderation_enforcement (moderation_hidden table)', true,
     to_regclass('public.moderation_hidden') IS NOT NULL),
  ('Needs: is_moderation_hidden(text, uuid, uuid)', true,
     to_regprocedure('public.is_moderation_hidden(text,uuid,uuid)') IS NOT NULL),
  ('Needs: is_blocked_pair(uuid, uuid)', true, to_regprocedure('public.is_blocked_pair(uuid,uuid)') IS NOT NULL),
  ('Needs: is_moderator()', true, to_regprocedure('public.is_moderator()') IS NOT NULL),
  ('#8 replaces get_shared_preview(p_type text, p_id uuid) returning jsonb', true,
     (SELECT pg_get_function_identity_arguments(p.oid) = 'p_type text, p_id uuid' AND pg_get_function_result(p.oid) = 'jsonb'
      FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_shared_preview(text,uuid)'))),
  ('#8 replaces get_explore_lists: exactly one version, (p_mode text)', true,
     (SELECT array_agg(pg_get_function_identity_arguments(p.oid)) = ARRAY['p_mode text']
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'get_explore_lists')),
  ('#10 needs place_cache(apple_place_id, category)', true,
     (SELECT count(*) = 2 FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name = 'place_cache' AND column_name IN ('apple_place_id', 'category'))),
  ('#10 needs restaurants(place_id, category, apple_place_id)', true,
     (SELECT count(*) = 3 FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name = 'restaurants' AND column_name IN ('place_id', 'category', 'apple_place_id'))),
  ('#7/#8/#14 need custom_list_items(list_id, user_id)', true,
     (SELECT count(*) = 2 FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name = 'custom_list_items' AND column_name IN ('list_id', 'user_id'))),
  ('Needs tables: follows, profiles, folders, custom_list_types, custom_list_statuses, content_reports, recipes', true,
     (SELECT count(*) = 7 FROM unnest(ARRAY['follows', 'profiles', 'folders', 'custom_list_types',
        'custom_list_statuses', 'content_reports', 'recipes']) t WHERE to_regclass('public.' || t) IS NOT NULL)),
  ('Not applied yet: #7 list-owner check on custom_list_items', false,
     EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'custom_list_items'
        AND cmd = 'INSERT' AND with_check LIKE '%custom_lists%')),
  ('Not applied yet: #8 custom_lists.visibility', false,
     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name = 'custom_lists' AND column_name = 'visibility')),
  ('Not applied yet: #8 content_reports.via_anonymous', false,
     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name = 'content_reports' AND column_name = 'via_anonymous')),
  ('Not applied yet: #8 list functions', false,
     EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
        AND p.proname IN ('can_view_custom_list', 'custom_lists_discovery_token', 'custom_list_anonymous_view',
                          'get_discoverable_list', 'get_list_discovery_preview', 'report_discoverable_list'))),
  ('Not applied yet: #10 get_discovery_places', false,
     EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'get_discovery_places')),
  ('Not applied yet: #13 own-folder custom-list upload policy', false,
     EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname = 'Users can upload custom list images to own folder')),
  ('Not applied yet: #14 place-owner check on restaurant_images', false,
     EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'restaurant_images'
        AND cmd = 'INSERT' AND with_check LIKE '%restaurants%'))
) AS v(check_name, expected, actual);
```

**Expected:** every row `ok = true`. A "Needs" row that fails means production is missing something the repo assumes. A "Not applied yet" row that fails means that migration (or something like it) is already there. Either way, stop and report.

5e: existing data the migrations care about:

```sql
-- READ ONLY
SELECT 'custom list items whose owner differs from the list owner (#7)' AS check_name, count(*) AS rows_found
FROM public.custom_list_items i JOIN public.custom_lists l ON l.id = i.list_id WHERE i.user_id <> l.user_id
UNION ALL
SELECT 'place photos attached by someone other than the place owner (#14)', count(*)
FROM public.restaurant_images ri JOIN public.restaurants r ON r.id = ri.restaurant_id WHERE ri.user_id <> r.user_id
UNION ALL
SELECT 'list photos attached by someone other than the item owner (#14)', count(*)
FROM public.custom_list_item_images ci JOIN public.custom_list_items i ON i.id = ci.item_id WHERE ci.user_id <> i.user_id
UNION ALL
SELECT 'custom-list files whose folder is not their uploader''s (#13)', count(*)
FROM storage.objects o
WHERE o.bucket_id = 'custom-list-images'
  AND coalesce(to_jsonb(o) ->> 'owner_id', to_jsonb(o) ->> 'owner') IS NOT NULL
  AND coalesce(to_jsonb(o) ->> 'owner_id', to_jsonb(o) ->> 'owner') <> split_part(o.name, '/', 1);
```

**Expected:** all 0.
- The migrations still apply if not; they hide or refuse those rows and delete nothing.
- Any non-zero count needs a separate data decision.
- The last row works whether the storage table names its owner column `owner` or `owner_id`.

### After the migrations are approved and applied

Re-run 4c with this list. These are the policies once #7, #8, #13 and #14 are in; #10 changes no policies. Expected: no rows.

```sql
-- READ ONLY
WITH expected(schemaname, tablename, policyname, cmd) AS (VALUES
    ('public', 'content_reports', 'Anonymous list reports are not readable by reporters', 'SELECT'),
    ('public', 'content_reports', 'Moderators can resolve reports', 'UPDATE'),
    ('public', 'content_reports', 'Moderators can view all reports', 'SELECT'),
    ('public', 'content_reports', 'Users can file reports', 'INSERT'),
    ('public', 'content_reports', 'Users can view their own reports', 'SELECT'),
    ('public', 'custom_list_item_images', 'Users can delete their own custom list item images', 'DELETE'),
    ('public', 'custom_list_item_images', 'Users can insert their own custom list item images', 'INSERT'),
    ('public', 'custom_list_item_images', 'Users can view photos of custom lists shared with them', 'SELECT'),
    ('public', 'custom_list_item_images', 'Users can view their own custom list item images', 'SELECT'),
    ('public', 'custom_list_items', 'Blocked users cannot view custom list items', 'SELECT'),
    ('public', 'custom_list_items', 'Hidden list items are not shown', 'SELECT'),
    ('public', 'custom_list_items', 'Users can delete their own custom list items', 'DELETE'),
    ('public', 'custom_list_items', 'Users can insert their own custom list items', 'INSERT'),
    ('public', 'custom_list_items', 'Users can update their own custom list items', 'UPDATE'),
    ('public', 'custom_list_items', 'Users can view items of custom lists shared with them', 'SELECT'),
    ('public', 'custom_list_items', 'Users can view their own custom list items', 'SELECT'),
    ('public', 'custom_list_statuses', 'Users can delete their own list statuses', 'DELETE'),
    ('public', 'custom_list_statuses', 'Users can insert their own list statuses', 'INSERT'),
    ('public', 'custom_list_statuses', 'Users can update their own list statuses', 'UPDATE'),
    ('public', 'custom_list_statuses', 'Users can view statuses of custom lists shared with them', 'SELECT'),
    ('public', 'custom_list_statuses', 'Users can view their own list statuses', 'SELECT'),
    ('public', 'custom_list_types', 'Users can delete their own list types', 'DELETE'),
    ('public', 'custom_list_types', 'Users can insert their own list types', 'INSERT'),
    ('public', 'custom_list_types', 'Users can update their own list types', 'UPDATE'),
    ('public', 'custom_list_types', 'Users can view their own list types', 'SELECT'),
    ('public', 'custom_list_types', 'Users can view types of custom lists shared with them', 'SELECT'),
    ('public', 'custom_lists', 'Blocked users cannot view custom lists', 'SELECT'),
    ('public', 'custom_lists', 'Hidden lists are not shown', 'SELECT'),
    ('public', 'custom_lists', 'Users can delete their own custom lists', 'DELETE'),
    ('public', 'custom_lists', 'Users can insert their own custom lists', 'INSERT'),
    ('public', 'custom_lists', 'Users can update their own custom lists', 'UPDATE'),
    ('public', 'custom_lists', 'Users can view custom lists shared with them', 'SELECT'),
    ('public', 'custom_lists', 'Users can view their own custom lists', 'SELECT'),
    ('public', 'restaurant_images', 'Users can delete their own images', 'DELETE'),
    ('public', 'restaurant_images', 'Users can insert their own images', 'INSERT'),
    ('public', 'restaurant_images', 'Users can view images from followed users', 'SELECT'),
    ('public', 'restaurant_images', 'Users can view own restaurant images', 'SELECT'),
    ('public', 'restaurants', 'Blocked users cannot view restaurants', 'SELECT'),
    ('public', 'restaurants', 'Hidden restaurants are not shown', 'SELECT'),
    ('public', 'restaurants', 'Users can delete their own restaurants', 'DELETE'),
    ('public', 'restaurants', 'Users can insert their own restaurants', 'INSERT'),
    ('public', 'restaurants', 'Users can update their own restaurants', 'UPDATE'),
    ('public', 'restaurants', 'Users can view own restaurants', 'SELECT'),
    ('public', 'restaurants', 'Users can view restaurants of people they follow', 'SELECT'),
    ('public', 'restaurants', 'Users can view restaurants of public profiles', 'SELECT'),
    ('storage', 'objects', 'Users can delete their own custom list images', 'DELETE'),
    ('storage', 'objects', 'Users can delete their own images', 'DELETE'),
    ('storage', 'objects', 'Users can upload custom list images to own folder', 'INSERT'),
    ('storage', 'objects', 'Users can upload to own folder', 'INSERT'),
    ('storage', 'objects', 'Users can view images from followed users', 'SELECT'),
    ('storage', 'objects', 'Users can view own images', 'SELECT'),
    ('storage', 'objects', 'Users can view their own custom list images', 'SELECT')
), scope AS (SELECT DISTINCT schemaname, tablename FROM expected)
SELECT coalesce(e.schemaname, p.schemaname) AS schema_name,
       coalesce(e.tablename, p.tablename) AS table_name,
       coalesce(e.policyname, p.policyname) AS policy_name,
       CASE WHEN p.policyname IS NULL THEN 'MISSING in production'
            WHEN e.policyname IS NULL THEN 'EXTRA in production (not in repo)'
            ELSE 'DIFFERENT command: repo ' || e.cmd || ', production ' || p.cmd END AS problem
FROM expected e
FULL JOIN (SELECT pp.* FROM pg_policies pp JOIN scope s USING (schemaname, tablename)) p
  ON p.schemaname = e.schemaname AND p.tablename = e.tablename AND p.policyname = e.policyname
WHERE p.policyname IS NULL OR e.policyname IS NULL OR p.cmd <> e.cmd
ORDER BY 1, 2, 3;
```

Then re-run 5d: the "Not applied yet" rows should now read `actual = true`.

---

## 3. Staging acceptance build (iPhone)

**Goal:** run the combined code (`stack/14-photo-records-owner-check`) on a real iPhone, against a backend that has every pending migration applied, without:
- merging anything;
- publishing afiyeat.com;
- touching the production database;
- replacing the production app on the phone.

### What's needed

| Item | Why |
|---|---|
| A **separate Supabase project** on your own supabase.com account (free plan), e.g. `afiyeat-staging` | Lovable Cloud has no staging copy. Your supabase.com account has no access to the Lovable Cloud project, so the CLI can't reach production even by mistake. |
| Supabase CLI on the Mac (`brew install supabase/tap/supabase`) | Applies the migrations and deploys the edge functions. |
| An Apple Maps key for staging: a new MapKit key from developer.apple.com (Certificates, IDs & Profiles → Keys → MapKit JS) | Place search (`apple-maps` function) needs `APPLE_MAPS_KEY_ID`, `APPLE_MAPS_PRIVATE_KEY` and `APNS_TEAM_ID` (`A7V4PN4DWK`). Production's key can't be read out of Lovable. |
| Xcode with your developer team signed in, and the iPhone in developer mode | Installs the staging build directly. |
| 4 test accounts (below) | Two-account security tests and the follower rules. |

Not needed for staging: push notifications (APNs), Resend email, Ticketmaster events, AI recipe scan.

### Steps

1. **Create the project.** supabase.com → New project → `afiyeat-staging`. Note its **project ref** and **anon (publishable) key** (Project Settings → API).

2. **Get the code** (on the Mac, in the existing clone):
   ```sh
   cd ~/Desktop/ME/Projects/afiyeat/afiyeat-app
   git status   # must be clean
   git fetch origin
   git switch --detach origin/stack/14-photo-records-owner-check
   npm ci
   ```

3. **Apply every migration to staging only:**
   ```sh
   supabase login
   supabase link --project-ref <STAGING_REF>
   cat supabase/.temp/project-ref        # must print <STAGING_REF>, never dmlkjpjubneqhbqoxlct
   supabase db push --dry-run            # lists all 86 migrations, ending with 20261111120000
   supabase db push
   ```
   - This applies all 81 migrations from `main`, then the 5 pending ones in timestamp order (section 4).
   - This is the first time the full chain is replayed on an empty database. If a file fails, `db push` stops there. Send the error; don't edit old migrations to make it pass.

4. **Buckets.** Staging → Storage:
   - Check `restaurant-images` exists and is private.
   - **Create `custom-list-images`** (no migration creates it): private, with the same file-size limit and mime types as production (check 3a).

5. **Edge functions and secrets:**
   ```sh
   supabase functions deploy --project-ref <STAGING_REF>
   supabase secrets set --project-ref <STAGING_REF> \
     APPLE_MAPS_KEY_ID=<new key id> APNS_TEAM_ID=A7V4PN4DWK \
     APPLE_MAPS_PRIVATE_KEY="$(cat ~/Downloads/AuthKey_<new key id>.p8)"
   ```

6. **Test accounts.** Staging → Authentication → Add user → Create new user, with **Auto Confirm User** on. The app signs in with email + password, and the `handle_new_user` trigger creates each profile. Use addresses you control, e.g. plus-addresses of your own email:

   | Account | Role in the tests |
   |---|---|
   | **Owner** | Owns places, lists and photos. Set the profile to **private** in the app, so follow requests need approval. |
   | **Friend** | Owner and Friend follow each other (accepted both ways). Plays the "other account" in the security tests. |
   | **Pending** | Requests to follow Owner; leave it **pending**. |
   | **Stranger** | No relationship. |

7. **Build the app against staging** (web bundle first):
   ```sh
   cat > .env.staging.local <<EOF
   VITE_SUPABASE_URL=https://<STAGING_REF>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<staging anon key>
   VITE_SUPABASE_PROJECT_ID=<STAGING_REF>
   EOF
   npm run build -- --mode staging
   grep -oh "https://[a-z0-9]*\.supabase\.co" dist/assets/*.js | sort -u   # must print ONLY the staging URL
   npx cap sync ios
   npx cap open ios
   ```
   - `.env.staging.local` is git-ignored (`*.local`) and takes precedence over `.env` in this mode.
   - **If the grep shows `dmlkjpjubneqhbqoxlct`, stop**: the build would talk to production.

8. **Install alongside the production app.** In Xcode, App target:
   - General → **Display Name** `Afiyeat Staging`.
   - Signing & Capabilities → **Bundle Identifier** `com.afiyeat.app.staging`. Automatic signing registers it.
   - If signing complains about Push Notifications or Associated Domains, remove those two capabilities for this build only.
   - Choose the iPhone and **Run**.

   **Never commit these Xcode changes.** Afterwards, run `git checkout -- ios/` and `git switch -` to restore them.

9. **Optional: reproduce Bistro Monadnock's broken photos first.**
   - Before step 7, build `origin/main` the same way (steps 7–8) and sign in as Owner.
   - Add a place, then add 2 photos **from Edit**. On `main` they show the "?" icon; this is the original bug.
   - Then build and install the stack.

   The same photos must now load. Running `main` against the migrated staging backend also confirms that today's app keeps working after the migrations, which matters because older app versions stay in use.

**Don't, at any point:**
- switch Lovable to a `stack/*` branch;
- let Lovable publish;
- put staging keys into `.env`;
- run `supabase link` with the production ref.

### Acceptance steps

Run on the iPhone (`Afiyeat Staging`), signed in as the account named.

**Photos, PR #12**
- [ ] Owner: the 11 steps in `docs/LISTING_PHOTOS.md` (including the Airplane-Mode upload interruption).
- [ ] Optional, after step 9: the photos uploaded on the `main` build load in the stack build.
- [ ] Edit → add 2 photos: spinner tiles appear, then both photos, without closing the dialog. Close and reopen the place, force-quit and relaunch: they're still there.
- [ ] A photo that can't load shows "Photo unavailable" + Retry, never "?".

**Privacy and security, PR #12, #13, #14**
- [ ] Friend: Owner's place photos load (accepted follower).
- [ ] Pending and Stranger: Owner's photos don't load (Owner's profile is private).
- [ ] Owner: custom-list item photo uploads still work (#13).
- [ ] Two-account rejection on the real backend (staging only). On the Mac, with Friend's credentials:
  ```sh
  URL=https://<STAGING_REF>.supabase.co; ANON=<staging anon key>
  TOKEN=$(curl -s "$URL/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "Content-Type: application/json" \
    -d '{"email":"<friend email>","password":"<friend password>"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
  FRIEND=$(curl -s "$URL/auth/v1/user" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
  # Friend tries to attach a photo record to Owner's place (#14) - expect 403
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "$URL/rest/v1/restaurant_images" -H "apikey: $ANON" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"restaurant_id\":\"<OWNER_PLACE_ID>\",\"user_id\":\"$FRIEND\",\"image_url\":\"test\"}"
  # Friend tries to upload into Owner's custom-list folder (#13) - expect 400 or 403
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "$URL/storage/v1/object/custom-list-images/<OWNER_ID>/x/test.jpg" \
    -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H "Content-Type: image/jpeg" --data-binary 'x'
  ```
  - Get `<OWNER_PLACE_ID>` and `<OWNER_ID>` from the staging Table Editor (`restaurants`). Friend can legitimately see that place id as a follower.
  - Repeat the first request with Friend's own place id: expect 201.

**Universal Add Item and Home Add-to-List, #7 and #11**
- [ ] Lists → Add item with photos, once each to My Restaurants, a custom list and a shared list. The item saves; photos attach to My Restaurants and custom-list items.
- [ ] With Airplane Mode toggled mid-save: the item is kept and the photo warning appears.
- [ ] Home → Add to a list: switching destination lists shows that list's own statuses, types and rating; place and notes are kept.

**Community list discovery and categories, #8 and #10**
- [ ] Owner: set lists to Private / Profile / Anonymous. Stranger sees only the Anonymous one in Explore → Lists, without the author. Friend sees Profile lists.
- [ ] Explore → Lists: search works; opening an anonymous list works; reporting it works.
- [ ] Explore categories (Food, Coffee, Drinks, …) show matching places; Lists never shows place cards.

**Navigation, #1**
- [ ] `docs/USER_TEST_CHECKLIST.md` navigation section: tabs, back behaviour, deep links. Universal links open the production app, not the staging one; that's expected.

**Persistence**
- [ ] Force-quit and relaunch after the steps above: everything saved is still there.

Pass = every box ticked. Record any failure with the account, the screen and the time.

---

## 4. Migration order

| Order | Migration | From | Depends on |
|---|---|---|---|
| 1 | `20261029120000_custom_list_items_owner_check` | #7 | — |
| 2 | `20261030120000_list_visibility_and_anonymous_discovery` | #8 | moderation_enforcement, blocks (section 5d) |
| 3 | `20261109120000_discovery_places` | #10 | Apple places (`place_cache`, `restaurants.category`) |
| 4 | `20261109180000_custom_list_images_owner_folder` | #13 | — |
| 5 | `20261111120000_photo_records_owner_check` | #14 | — |

- The five don't depend on one another, so timestamp order is fine. #14 deliberately leaves the list read policies #8 drops alone.
- **Ordering against code:** apply #8's and #10's migrations **before** afiyeat.com publishes code that calls their functions (`get_discoverable_list`, `get_discovery_places`, …).
- #7, #13 and #14 are compatible with the current app, so they can go first.
- Production preconditions: sections 2.1, 4 and 5 pass.
- Each migration goes in through Lovable as one transaction, with its version recorded. Afterwards, re-run 4c (after-list) and 5d.
