# Production read-only checks through Lovable (2026-11-20, 19:55–19:57 UTC)

Run in Lovable **Chat** mode (no code edits). Every message used the read-only wording; Lovable ran each query once and changed nothing.

- **Role:** `supabase_read_only_user` (`rolbypassrls = true`, `rolsuper = false`), so the counts are complete and not filtered by RLS.

## Q1 — policies touched by pending migrations #7, #8, #13, #14

All 20 rows production returned are **identical** to the lab replay of `main` 9baf34e, in name, command, roles and text. The comparison is made with `qa/compat/production/expected-policies.md`.

| Compared against | Production-only rows | Lab-only rows | Text differs | Roles differ |
|---|---|---|---|---|
| main (before) | 0 | 0 | 0 | 0 |
| main + 5 pending migrations (after) | 5 | 3 | 5 | 4 |

**None of the five pending migrations are applied in production.** The earlier probes reached the same conclusion for #8 and #10.

Pre-existing policy facts, kept unchanged by V2 until #13 is applied:
- Uploads to `custom-list-images` only require a signed-in user. They don't check that the file goes into the uploader's own folder.
- Viewing in that bucket is limited to the owner's own folder.

## Q2 — storage buckets

| Bucket | Public | Size limit | Allowed types | Created |
|---|---|---|---|---|
| `custom-list-images` | false | none | any | 2026-08-14 (not created by any migration) |
| `restaurant-images` | false | 5 MB | jpeg, png, gif, webp | 2025-12-06 |

## Q3 — data shape (counts only, all users)

```json
{
  "counts": {"blocked_users": 0, "custom_list_item_images": 4, "custom_list_items": 15, "custom_list_statuses": 11, "custom_list_types": 0,
             "custom_lists": 5, "folders": 130, "follows_by_status": {"accepted": 15}, "private_profiles": 1, "restaurant_images": 167,
             "restaurants": 238, "shared_list_item_comments": 0, "shared_list_items": 0, "shared_lists": 0, "users_with_lists": 3},
  "items": {"HIDDEN_location_with_value": 0, "HIDDEN_notes_with_value": 0, "HIDDEN_photos_with_photos": 0, "HIDDEN_price_with_value": 0,
            "HIDDEN_rating_with_value": 0, "address_without_coordinates": 0, "apple_place_id_set": 8, "completed_at_set": 4,
            "duplicate_names_in_same_list": 0, "legacy_status_text": {"done": 4, "todo": 11}, "name_max_length": 23, "notes_max_length": 56,
            "price_level_range": [null, null], "price_manual_set": 0, "rating_manual_set": 0, "rating_range": [7, 10], "status_id_null": 0,
            "status_id_of_another_list": 0, "type_id_set": 0, "type_ids_length": {"0": 15}, "type_ids_pointing_outside_list": 0},
  "lists": {"field_flag_combinations": [
              {"n": 1, "price_mode": "dollar", "rating_mode": "scale_10", "show_location": true,  "show_notes": true, "show_photos": true,  "show_price": false, "show_rating": true},
              {"n": 1, "price_mode": "dollar", "rating_mode": "scale_10", "show_location": true,  "show_notes": true, "show_photos": true,  "show_price": false, "show_rating": false},
              {"n": 1, "price_mode": "dollar", "rating_mode": "scale_10", "show_location": false, "show_notes": true, "show_photos": false, "show_price": false, "show_rating": true},
              {"n": 1, "price_mode": "dollar", "rating_mode": "scale_10", "show_location": false, "show_notes": true, "show_photos": true,  "show_price": true,  "show_rating": false},
              {"n": 1, "price_mode": "dollar", "rating_mode": "scale_10", "show_location": true,  "show_notes": true, "show_photos": true,  "show_price": true,  "show_rating": false}],
            "icons_top": {"📋": 5}, "lists_with_0_items": 2, "lists_with_0_statuses": 0, "lists_with_categories": 0,
            "lists_with_over_5_statuses": 0, "max_items_per_list": 7, "max_lists_per_user": 2, "name_max_length": 7, "null_todo_or_done_label": 0},
  "my_restaurants": {"folder_id_set": 142, "folder_ids_length": {"0": 54, "1": 170, "2": 14}, "status": {"to_go": 82, "went_to": 156}},
  "photos": {"items_with_over_5_photos": 0, "max_photos_on_one_item": 3, "max_photos_on_one_restaurant": 10,
             "stored_formats": {"custom_list_item_images: full public URL": 4, "restaurant_images: bare path": 38, "restaurant_images: full public URL": 129}},
  "rows_the_new_owner_checks_would_reject": {"item_photo_rows_file_missing": 0, "item_photo_rows_outside_owner_folder": 0,
             "m13_list_photo_objects_outside_owner_folder": 0, "m14_item_photo_user_differs_from_item_owner": 0,
             "m14_restaurant_photo_user_differs_from_restaurant_owner": 0, "m7_item_user_differs_from_list_owner": 0, "orphan_item_photos": 0},
  "shared": {"item_status": null, "max_items_per_shared_list": null}
}
```

## What this means for Lists V2

* **Custom lists**
  - Production holds 5 lists from 3 users: 15 items, 11 statuses and 4 photos, all stored as full URLs.
  - It has no categories, shared lists, manual prices or ratings, and no values in hidden fields.
  - Every item has a valid status in its own list.
  - The lab's synthetic data covers all of these shapes and more.
* **The migrations' new owner checks reject no existing row.** No photo row points outside its owner's folder or at a missing file.
* **My Restaurants holds most of the real data:**
  - 238 places and 167 photos, in both stored formats.
  - 130 folders; each place belongs to up to 2 folders.
  - One place has **10 photos**, more than the 5-photo cap. Lists V2 shows all photos and deletes none unless the user removes one. The own-data run checks saving such a place unchanged.
* **Follows:** 15 accepted, and 1 private profile.
