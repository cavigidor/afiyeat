# Listing photos: how they work, the November 2026 display bug, and recovery

## How a photo gets from the camera to the carousel

| Step | Where |
| --- | --- |
| Pick / take photo, validate type and size, downscale to JPEG | `lib/imageValidation.ts` (`validateImageFile`, `compressImage`) |
| Upload to the owner's folder `<user>/<item>/<uuid>.<ext>` in a **private** bucket | `lib/photoUpload.ts` (`uploadRestaurantPhotos`, `uploadCustomListPhotos`) |
| Insert the attachment row (client-chosen id) and read it back | same helper; `restaurant_images` / `custom_list_item_images` |
| Stored value in `image_url` | `toStoredImageUrl()` → `<supabase>/storage/v1/object/public/<bucket>/<path>` (identifies the object; never loaded directly) |
| Load the listing | `MyList`, `CustomListDetail`, `Friends`, `PublicProfile` embed `images:restaurant_images(...)` |
| Turn the stored value into something an `<img>` can load | `lib/storage.ts` `parseStorageRef` → `signImageRef` (1-hour signed URL, cached) |
| Render | `components/shared/StorageImage.tsx` (spinner until loaded, one automatic re-sign on load error, then "Photo unavailable" + Retry) |
| Refresh after adding photos | Edit place: `ImageUploadSection` keeps a live `['restaurant-images', id]` query and adds the returned rows immediately; the list query is invalidated. Detail sheet reads the place from the live list by id. |

Buckets: `restaurant-images` (owner + accepted followers can read) and `custom-list-images` (owner only). Nothing in the fix changes bucket privacy or policies; `tests/listingPhotos.policies.test.ts` runs the repository's policies to prove it.

## When the network answer can't be trusted

A request can time out, lose its response, or succeed without returning the row. `lib/photoUpload.ts` handles that as follows:

| What happened | How it's told apart | What the helper does |
| --- | --- | --- |
| Row saved and returned | 2xx with the row | Done |
| Database refused the only attempt | HTTP 4xx **with** a Postgres/PostgREST code (e.g. 403 + 42501) | Statement rolled back, so nothing references the new object: it is removed (only that object) |
| Response lost, timeout, gateway 5xx/429, no row returned (PGRST116), exception | Anything else | **Never deletes.** Looks the row up by its client-chosen id (owner-only by RLS). Not there → retries the insert once with the same id (a repeat hits the primary key, 23505, which proves it's saved). Still unclear → reports the photo as *unconfirmed*, keeps the object, logs its path and row id |
| Upload response lost / timed out | No HTTP 4xx from storage | Retries the same path once; "already exists" (409) proves the first upload landed. Still failing → reported, nothing removed |

Timeouts: upload 60 s, insert 15 s, lookup 10 s. An unconfirmed photo shows the message "Couldn't confirm the photo was saved - refresh in a moment to check." and the photo list refetches, so a row that did land appears. Objects kept this way without a row show up in the orphan report (query 3) for manual review.

## Root causes (November 2026)

1. **Broken image (Problem B).** Two writers stored `image_url` differently. Add place stored the public-URL shape; **Edit place (`ImageUploadSection`, since April 2026) stored a bare path** `<user>/<restaurant>/<file>`. The display helpers originally treated a bare path as a path, but the multi-bucket refactor in `85082dd` (14 Aug 2026, "Add My Lists") dropped that branch, and the carousel's batch hook never signed bare paths at all. A bare path was therefore handed to `<img>` unchanged, the browser resolved it relative to the app (`https://afiyeat.com/<user>/<restaurant>/<file>` or `capacitor://localhost/...`), and the request never reached Supabase. That is the "?" icon with the place name as alt text. The object and the row are both fine.
2. **Photo doesn't appear after upload (Problem A).** The Edit dialog received a snapshot of the place taken when it opened. Uploading wrote the row and invalidated the list, but the dialog kept rendering the snapshot, so the new photo only appeared after closing and reopening, and then, because of (1), as a broken image.
3. **Silent partial failures.** Add place and custom-list Add/Edit ignored a failed record insert and only logged a failed upload, then showed "added successfully".

(1) and (2) are the same user action: "Been There" opens Edit, the person adds photos there, sees nothing, reopens, and sees a broken image.

## Is an affected photo recoverable?

Bare-path rows from the Edit uploader: **yes, with no data change.** The object exists and the row points at it; the fixed reader signs bare paths. Run the read-only report below to confirm per row.

| Case | Detected by `status` below | Recovery |
| --- | --- | --- |
| Object exists, `image_url` is a bare path | `ok_bare_path` | Fixed by the code. Optional normalisation UPDATE below, not required. |
| Object exists, public-shaped URL | `ok` | Nothing to do. |
| Row's object is in another user's folder | `owner_mismatch` | Investigate individually; do not change policies. |
| Row points at a missing object | `missing_object` | Not recoverable. The app now shows "Photo unavailable"; the owner can remove it from Edit and re-add. |
| Object with no row (uploaded, insert failed) | orphan report | Re-link only after review (statement below), owner by owner. |

### Read-only report (run in Lovable Cloud SQL, or the Supabase SQL editor)

```sql
-- 1. Every restaurant photo row, classified. SELECT only.
WITH rows AS (
  SELECT ri.id, ri.restaurant_id, ri.user_id, r.name AS place, ri.image_url, ri.created_at,
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
)
SELECT rows.*,
  CASE
    WHEN fmt = 'external' THEN 'external'
    WHEN o.id IS NULL THEN 'missing_object'
    WHEN split_part(object_path, '/', 1) <> rows.user_id::text THEN 'owner_mismatch'
    WHEN fmt = 'bare_path' THEN 'ok_bare_path'
    ELSE 'ok'
  END AS status
FROM rows
LEFT JOIN storage.objects o ON o.bucket_id = 'restaurant-images' AND o.name = rows.object_path
ORDER BY status, created_at DESC;

-- 1a. Just the reported place.
--     ... add: WHERE place ILIKE 'Bistro Monadnock%'

-- 2. Summary.
--     Wrap query 1 as a CTE and: SELECT status, count(*) FROM report GROUP BY status;

-- 3. Orphans: listing photos in storage with no row (3-segment paths are
--    listing photos; 2-segment <user>/<timestamp>.ext paths are recipe images).
SELECT o.name, o.created_at, r.name AS place
FROM storage.objects o
LEFT JOIN public.restaurants r ON r.id::text = split_part(o.name, '/', 2) AND r.user_id::text = split_part(o.name, '/', 1)
WHERE o.bucket_id = 'restaurant-images'
  AND array_length(string_to_array(o.name, '/'), 1) = 3
  AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_images ri
    WHERE ri.image_url = o.name
       OR ri.image_url LIKE '%/restaurant-images/' || o.name
       OR ri.image_url LIKE '%/restaurant-images/' || o.name || '?%'
  )
ORDER BY o.created_at DESC;

-- 4. Same checks for custom lists (owner-only bucket). Also confirms the
--    bucket exists: the Lovable copy of the custom-lists migration doesn't
--    create it.
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets
WHERE id IN ('restaurant-images', 'custom-list-images');
```

### Optional, needs PM approval: normalise bare paths

Not required for display. Rewrites only rows whose object exists and is in the row owner's folder; changes no files. Take a backup of `restaurant_images` first.

```sql
-- PREVIEW (read-only): the rows the UPDATE would touch.
SELECT ri.id, ri.image_url FROM public.restaurant_images ri
JOIN storage.objects o ON o.bucket_id = 'restaurant-images' AND o.name = ri.image_url
WHERE ri.image_url !~ '^[A-Za-z][A-Za-z0-9+.-]*:' AND left(ri.image_url, 1) <> '/'
  AND split_part(ri.image_url, '/', 1) = ri.user_id::text;

-- APPLY (only after approval):
-- UPDATE public.restaurant_images ri
-- SET image_url = 'https://dmlkjpjubneqhbqoxlct.supabase.co/storage/v1/object/public/restaurant-images/' || ri.image_url
-- FROM storage.objects o
-- WHERE o.bucket_id = 'restaurant-images' AND o.name = ri.image_url
--   AND ri.image_url !~ '^[A-Za-z][A-Za-z0-9+.-]*:' AND left(ri.image_url, 1) <> '/'
--   AND split_part(ri.image_url, '/', 1) = ri.user_id::text;
```

### Optional, needs PM approval: re-link a reviewed orphan

One object at a time, after confirming with query 3 that the place exists, belongs to the folder owner, and has fewer than 5 photos:

```sql
-- INSERT INTO public.restaurant_images (restaurant_id, user_id, image_url)
-- VALUES ('<restaurant id>', '<user id>',
--   'https://dmlkjpjubneqhbqoxlct.supabase.co/storage/v1/object/public/restaurant-images/<object name>');
```

Nothing here deletes, overwrites or re-uploads a photo.

## Seeing the failing request yourself

On afiyeat.com, signed in, open the place and run in the browser console:

```js
[...document.querySelectorAll('[role=dialog] img')].map((i) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 }))
```

Before the fix a broken photo's `src` is a bare `<user>/<restaurant>/<file>` path (no `https://`), and the Network tab shows the request going to afiyeat.com, not to `*.supabase.co`. After the fix every `src` is `https://<project>.supabase.co/storage/v1/object/sign/...` and returns 200; a 400 "Object not found" there means the object is missing or the viewer isn't allowed to see it (storage answers both the same way; query 1 tells them apart).

## Acceptance steps (iPhone app and Safari/Chrome)

1. **Existing broken photo:** open Bistro Monadnock. Both carousel photos load (spinner first, then the image). No "?" icon.
2. **Add from Edit:** open a Been There place → Edit → add 2 photos. Two spinner tiles appear, then both photos, without closing the dialog. Toast "2 photos added".
3. **Reopen / refresh / restart:** close Edit, open the place: both new photos are in the carousel. Pull to refresh / reload the page / force-quit and relaunch the app: still there.
4. **Carousel:** with 3+ photos, the arrows and dots page through every photo.
5. **Add place with photos:** Add place with 2 photos → card thumbnail and carousel show them.
6. **Custom list item:** in a list with photos on, add an item with a photo, then edit it, add another and save: reopening Edit shows both, and the card shows the first.
7. **Interrupted upload:** start adding 2 photos from Edit and turn on Airplane Mode as the spinner tiles appear; wait for the message, turn it off, close and reopen Edit. Every photo is either shown or reported; no photo appears broken, and nothing that was shown disappears.
8. **Failure messages (Safari, Develop → Network conditions → Offline):** add a photo from Edit while offline → "Couldn't add the photo. Check your connection and try again."; the place and its existing photos are unchanged.
9. **Fallback:** a photo that can't load shows "Photo unavailable" with Retry, never the browser's broken-image icon.
10. **Privacy:** sign in as a user who doesn't follow the owner (or a pending follower) and open the owner's public profile/place: their photos do not load. An accepted follower sees them (Friends).
11. **Existing photos intact:** after all of the above, every photo that was there before is still there.
