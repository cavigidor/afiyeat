-- READ ONLY. Run in production immediately BEFORE the five migrations. Save the result: after
-- migrating, post-migration-checks.sql must show every count at least this high.
SELECT jsonb_pretty(jsonb_build_object(
  'taken_at', now(),
  'counts', jsonb_build_object(
    'custom_lists', (SELECT count(*) FROM public.custom_lists),
    'custom_list_statuses', (SELECT count(*) FROM public.custom_list_statuses),
    'custom_list_types', (SELECT count(*) FROM public.custom_list_types),
    'custom_list_items', (SELECT count(*) FROM public.custom_list_items),
    'custom_list_item_images', (SELECT count(*) FROM public.custom_list_item_images),
    'restaurants', (SELECT count(*) FROM public.restaurants),
    'restaurant_images', (SELECT count(*) FROM public.restaurant_images),
    'folders', (SELECT count(*) FROM public.folders),
    'shared_lists', (SELECT count(*) FROM public.shared_lists),
    'follows', (SELECT count(*) FROM public.follows),
    'storage_objects_list_and_place_photos', (SELECT count(*) FROM storage.objects WHERE bucket_id IN ('custom-list-images', 'restaurant-images')))
)) AS pre_migration;
