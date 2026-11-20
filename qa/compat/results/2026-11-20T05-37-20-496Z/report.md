# Lists V2 compatibility run 2026-11-20T05-37-20-496Z

old app main 9baf34e0b287b7dbb6b11909a1b509693cbcede0 · new app 4973aa7216e7e147966c1c86b79161144d2d8395 · Postgres 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

Summary: {"INFO":2,"PASS":49,"PRE-EXISTING":1,"FAIL":1}

| Phase | Check | Result | Detail |
|---|---|---|---|
| P0 seed | representative dataset loaded on main schema | INFO | auth.users=6, blocked_users=1, custom_list_item_images=7, custom_list_items=81, custom_list_statuses=28, custom_list_types=5, custom_lists=14, folders=42, follows=5, profiles=6, restaurant_images=5, restaurants=5, shared_list_item_comments=2, shared_list_items=2, shared_lists=1, storage.buckets=2, s |
| P1 old app / current schema | Lists page shows every existing list with its item count | PASS | 11 lists, 78 items |
| P1 old app / current schema | shared list visible | PASS |  |
| P1 old app / current schema | list "Coffee Shops ☕ İstanbul" opens with 4 items | PASS |  |
| P1 old app / current schema | list "Wines" opens with 2 items | PASS |  |
| P1 old app / current schema | list "Books 2026" opens with 3 items | PASS |  |
| P1 old app / current schema | list "Old travel list (pre-statuses)" opens with 2 items | PASS |  |
| P1 old app / current schema | list "Bakeries (notes hidden)" opens with 2 items | PASS |  |
| P1 old app / current schema | list "Big list (60 items)" opens with 60 items | PASS |  |
| P1 old app / current schema | no failed API calls, nothing sent off the machine except blocked map script | PASS | 4 blocked map-script requests |
| P1 old app / current schema | reading changes nothing in the database | PASS |  |
| P2 old app writes | Add Item creates exactly one new item in the right list | PASS |  |
| P2 old app writes | editing Petra saves the note and a new photo; other fields keep their values | PASS | photos on Petra now 2 (was 1) |
| P2 old app writes | old app editing an item whose list hides Notes ERASES the saved note | PRE-EXISTING | "HIDDEN-NOTE: try the cake" -> null (current live app behaviour; Lists V2 fixes it) |
| P2 old app writes | no other rows anywhere changed, nothing deleted | PASS | 7 expected changes: public.custom_list_item_images: ADDED 35a4e89f-a68b-4130-bf92-26e8a755e23e / public.custom_list_items: ADDED 2365a53f-a061-4876-b92f-23dd958b6fa7 / public.custom_list_items: e5e90702-b58e-5460-a763-453638cb6df4 .notes: null -> "Edited by the OLD app" / public.custom_list_items: e |
| P3 migrations | the five pending migrations apply (5) | PASS |  |
| P3 migrations | no existing row added, deleted or changed; only new columns | PASS | public.content_reports: NEW COLUMN via_anonymous / public.custom_lists: NEW COLUMN visibility / public.custom_lists: NEW COLUMN discovery_token |
| P3 migrations | every existing list keeps profile-based visibility and gets its own discovery token | PASS | 14/14 profile; 14 distinct tokens |
| P3 migrations | row counts identical in every table | PASS |  |
| P4 privacy | explained difference (not a visibility change) | INFO | anon / restaurant_images: before 0 rows -> after HTTP 401 {"code":"42501","details":null,"hint":null,"message":"permission denied for func: migration #14's restaurant_images policy now checks the parent restaurant, and signed-out visitors were already refused restaurants (is_moderator). No signed-ou |
| P4 privacy | every user (and a signed-out visitor) can see exactly the same rows and photos before and after the migrations | PASS | 7 viewers x 13 tables identical (+1 explained) |
| P4 privacy | stranger and pending follower cannot see the private account's list; blocked user cannot see Ayla's lists | PASS |  |
| P4 privacy | shared list visible only to its two members | PASS |  |
| P4 privacy | photos: only owners and permitted viewers can get signed links | PASS | ayla 11, bora 6, anon 0 signable objects |
| P5 old app / migrated schema | Lists page still shows every list with its item count | PASS |  |
| P5 old app / migrated schema | Add Item still works and touches nothing else | PASS |  |
| P5 old app / migrated schema | no failed API calls | PASS |  |
| P6 new app | Lists home shows every existing list with its item count (same data the old app showed) | PASS | 11 lists |
| P6 new app | shared list and My Restaurants visible | PASS |  |
| P6 new app | list "Coffee Shops ☕ İstanbul" opens and accounts for all 5 items | PASS |  |
| P6 new app | list "Wines" opens and accounts for all 3 items | PASS |  |
| P6 new app | list "Books 2026" opens and accounts for all 3 items | PASS |  |
| P6 new app | list "Old travel list (pre-statuses)" opens and accounts for all 2 items | PASS |  |
| P6 new app | list "Bakeries (notes hidden)" opens and accounts for all 2 items | PASS |  |
| P6 new app | list "Big list (60 items)" opens and accounts for all 60 items | PASS |  |
| P6 new app | list "Empty list" opens and accounts for all 0 items | PASS |  |
| P6 new app | item photos stored in both formats (old full URL and bare path) all load | PASS | 3 images loaded via signed URLs |
| P6 new app | quick add creates one item with the current status | PASS |  |
| P6 new app | editing an item whose list hides Notes KEEPS the saved note (and all other values) | PASS | notes still "HIDDEN-NOTE: get the profiterol" |
| P6 new app | hiding Price on a list keeps every item's price | PASS |  |
| P6 new app | adding a photo keeps existing photos | PASS | 2 -> 3 |
| P6 new app | nothing else in the database changed; nothing deleted | PASS | 9 expected changes |
| P6 new app | shared list opens with both members' items | PASS | Mikla (Ayla, To Go) and Balıkçı Sabahattin (Ece, Been There) |
| P6 new app | no failed API calls; nothing sent off the machine | PASS |  |
| P6 new app | stranger (pending follower) opening a private account's list sees no items | PASS |  |
| Overall | no existing row was deleted in any table across the whole run | PASS |  |
| Overall | no existing list was converted: name, icon, owner, created_at and field flags unchanged except the one Price toggle | PASS |  |
| Overall | every pre-existing item ID, list link and status/category link is intact | PASS | 81 items checked |
| P7 new app / un-migrated schema | Lists home on today's production schema shows every list | PASS | lists shown 11/11 |
| P7 new app / un-migrated schema | Home and Explore before #10: missing get_discovery_places falls back to get_explore_places | PASS | failed calls: 404 POST /rest/v1/rpc/get_discovery_places ; 404 POST /rest/v1/rpc/get_discovery_places (a 404 on get_discovery_places is the designed probe; anything else is a real failure) |
| P7 new app / un-migrated schema | Add Item before the migrations | PASS | rows created: 1; failed calls: none |
| P7 new app / un-migrated schema | "Who can see it" before #8 (needs the visibility column) | FAIL | app showed "Couldn’t change who can see it. Nothing was changed." — 400 PATCH /rest/v1/custom_lists?id=eq.fa19b458-a55e-5cfb-ac42-b58d8f6a104b |
| P7 new app / un-migrated schema | no rows deleted or lists converted while running before the migrations | PASS | none deleted |