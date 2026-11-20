WITH
li AS (SELECT l.*, (SELECT count(*) FROM public.custom_list_items i WHERE i.list_id = l.id) AS n_items,
              (SELECT count(*) FROM public.custom_list_statuses s WHERE s.list_id = l.id) AS n_statuses,
              (SELECT count(*) FROM public.custom_list_types t WHERE t.list_id = l.id) AS n_types
       FROM public.custom_lists l),
it AS (SELECT i.*, l.user_id AS list_owner, l.show_notes, l.show_price, l.show_rating, l.show_photos, l.show_location,
              (SELECT count(*) FROM public.custom_list_item_images m WHERE m.item_id = i.id) AS n_photos
       FROM public.custom_list_items i JOIN public.custom_lists l ON l.id = i.list_id),
fmt AS (SELECT CASE WHEN image_url ~ '/storage/v1/object/public/' THEN 'full public URL'
                    WHEN image_url ~ '/storage/v1/object/sign/' THEN 'signed URL (expires!)'
                    WHEN image_url ~ '^https?://' THEN 'other https URL'
                    WHEN image_url IS NULL OR image_url = '' THEN 'empty'
                    ELSE 'bare path' END AS f, 'custom_list_item_images' AS t FROM public.custom_list_item_images
        UNION ALL
        SELECT CASE WHEN image_url ~ '/storage/v1/object/public/' THEN 'full public URL'
                    WHEN image_url ~ '/storage/v1/object/sign/' THEN 'signed URL (expires!)'
                    WHEN image_url ~ '^https?://' THEN 'other https URL'
                    WHEN image_url IS NULL OR image_url = '' THEN 'empty'
                    ELSE 'bare path' END, 'restaurant_images' FROM public.restaurant_images)
SELECT (jsonb_build_object(
  'counts', jsonb_build_object(
    'users_with_lists', (SELECT count(DISTINCT user_id) FROM public.custom_lists),
    'custom_lists', (SELECT count(*) FROM public.custom_lists),
    'custom_list_statuses', (SELECT count(*) FROM public.custom_list_statuses),
    'custom_list_types', (SELECT count(*) FROM public.custom_list_types),
    'custom_list_items', (SELECT count(*) FROM public.custom_list_items),
    'custom_list_item_images', (SELECT count(*) FROM public.custom_list_item_images),
    'restaurants', (SELECT count(*) FROM public.restaurants),
    'restaurant_images', (SELECT count(*) FROM public.restaurant_images),
    'folders', (SELECT count(*) FROM public.folders),
    'shared_lists', (SELECT count(*) FROM public.shared_lists),
    'shared_list_items', (SELECT count(*) FROM public.shared_list_items),
    'shared_list_item_comments', (SELECT count(*) FROM public.shared_list_item_comments),
    'private_profiles', (SELECT count(*) FROM public.profiles WHERE is_private),
    'follows_by_status', (SELECT jsonb_object_agg(coalesce(status, 'null'), n) FROM (SELECT status, count(*) n FROM public.follows GROUP BY 1) x),
    'blocked_users', (SELECT count(*) FROM public.blocked_users)),
  'lists', jsonb_build_object(
    'max_lists_per_user', (SELECT max(n) FROM (SELECT count(*) n FROM public.custom_lists GROUP BY user_id) x),
    'max_items_per_list', (SELECT max(n_items) FROM li),
    'lists_with_0_items', (SELECT count(*) FROM li WHERE n_items = 0),
    'lists_with_0_statuses', (SELECT count(*) FROM li WHERE n_statuses = 0),
    'lists_with_over_5_statuses', (SELECT count(*) FROM li WHERE n_statuses > 5),
    'lists_with_categories', (SELECT count(*) FROM li WHERE n_types > 0),
    'icons_top', (SELECT jsonb_object_agg(coalesce(icon, 'null'), n) FROM (SELECT icon, count(*) n FROM public.custom_lists GROUP BY 1 ORDER BY 2 DESC LIMIT 25) x),
    'field_flag_combinations', (SELECT jsonb_agg(x) FROM (SELECT show_location, show_notes, show_photos, show_price, price_mode, show_rating, rating_mode, count(*) n FROM public.custom_lists GROUP BY 1,2,3,4,5,6,7 ORDER BY n DESC) x),
    'null_todo_or_done_label', (SELECT count(*) FROM public.custom_lists WHERE status_todo_label IS NULL OR status_done_label IS NULL),
    'name_max_length', (SELECT max(length(name)) FROM public.custom_lists)),
  'items', jsonb_build_object(
    'status_id_null', (SELECT count(*) FROM it WHERE status_id IS NULL),
    'status_id_of_another_list', (SELECT count(*) FROM it JOIN public.custom_list_statuses s ON s.id = it.status_id WHERE s.list_id <> it.list_id),
    'legacy_status_text', (SELECT jsonb_object_agg(coalesce(status, 'null'), n) FROM (SELECT status, count(*) n FROM public.custom_list_items GROUP BY 1) x),
    'type_id_set', (SELECT count(*) FROM it WHERE type_id IS NOT NULL),
    'type_ids_length', (SELECT jsonb_object_agg(k, n) FROM (SELECT coalesce(cardinality(type_ids), -1)::text k, count(*) n FROM public.custom_list_items GROUP BY 1) x),
    'type_ids_pointing_outside_list', (SELECT count(*) FROM it, unnest(coalesce(it.type_ids, '{}')) tid WHERE NOT EXISTS (SELECT 1 FROM public.custom_list_types t WHERE t.id = tid AND t.list_id = it.list_id)),
    'price_manual_set', (SELECT count(*) FROM it WHERE price_manual IS NOT NULL),
    'rating_manual_set', (SELECT count(*) FROM it WHERE rating_manual IS NOT NULL),
    'price_level_range', (SELECT jsonb_build_array(min(price_level), max(price_level)) FROM it),
    'rating_range', (SELECT jsonb_build_array(min(rating), max(rating)) FROM it),
    'HIDDEN_notes_with_value', (SELECT count(*) FROM it WHERE NOT show_notes AND nullif(notes, '') IS NOT NULL),
    'HIDDEN_price_with_value', (SELECT count(*) FROM it WHERE NOT show_price AND (price_level IS NOT NULL OR price_manual IS NOT NULL)),
    'HIDDEN_rating_with_value', (SELECT count(*) FROM it WHERE NOT show_rating AND (rating IS NOT NULL OR rating_manual IS NOT NULL)),
    'HIDDEN_location_with_value', (SELECT count(*) FROM it WHERE NOT show_location AND (address IS NOT NULL OR latitude IS NOT NULL)),
    'HIDDEN_photos_with_photos', (SELECT count(*) FROM it WHERE NOT show_photos AND n_photos > 0),
    'completed_at_set', (SELECT count(*) FROM it WHERE completed_at IS NOT NULL),
    'address_without_coordinates', (SELECT count(*) FROM it WHERE address IS NOT NULL AND latitude IS NULL),
    'apple_place_id_set', (SELECT count(*) FROM it WHERE apple_place_id IS NOT NULL),
    'duplicate_names_in_same_list', (SELECT count(*) FROM (SELECT list_id, lower(name) FROM public.custom_list_items GROUP BY 1, 2 HAVING count(*) > 1) x),
    'name_max_length', (SELECT max(length(name)) FROM it),
    'notes_max_length', (SELECT max(length(notes)) FROM it)),
  'photos', jsonb_build_object(
    'stored_formats', (SELECT jsonb_object_agg(t || ': ' || f, n) FROM (SELECT t, f, count(*) n FROM fmt GROUP BY 1, 2) x),
    'max_photos_on_one_item', (SELECT max(n_photos) FROM it),
    'items_with_over_5_photos', (SELECT count(*) FROM it WHERE n_photos > 5),
    'max_photos_on_one_restaurant', (SELECT max(n) FROM (SELECT count(*) n FROM public.restaurant_images GROUP BY restaurant_id) x)),
  'rows_the_new_owner_checks_would_reject', jsonb_build_object(
    'm7_item_user_differs_from_list_owner', (SELECT count(*) FROM it WHERE user_id <> list_owner),
    'm14_item_photo_user_differs_from_item_owner', (SELECT count(*) FROM public.custom_list_item_images m JOIN public.custom_list_items i ON i.id = m.item_id WHERE m.user_id <> i.user_id),
    'm14_restaurant_photo_user_differs_from_restaurant_owner', (SELECT count(*) FROM public.restaurant_images m JOIN public.restaurants r ON r.id = m.restaurant_id WHERE m.user_id <> r.user_id),
    'm13_list_photo_objects_outside_owner_folder', (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = 'custom-list-images' AND (storage.foldername(o.name))[1] IS DISTINCT FROM o.owner::text),
    'item_photo_rows_outside_owner_folder', (SELECT count(*) FROM public.custom_list_item_images m WHERE split_part(regexp_replace(regexp_replace(m.image_url, '^.*/storage/v1/object/(public|sign|authenticated)/custom-list-images/', ''), '[?#].*$', ''), '/', 1) <> m.user_id::text),
    'item_photo_rows_file_missing', (SELECT count(*) FROM public.custom_list_item_images m WHERE NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'custom-list-images' AND o.name = regexp_replace(regexp_replace(m.image_url, '^.*/storage/v1/object/(public|sign|authenticated)/custom-list-images/', ''), '[?#].*$', ''))),
    'orphan_item_photos', (SELECT count(*) FROM public.custom_list_item_images m WHERE NOT EXISTS (SELECT 1 FROM public.custom_list_items i WHERE i.id = m.item_id))),
  'my_restaurants', jsonb_build_object(
    'status', (SELECT jsonb_object_agg(coalesce(status, 'null'), n) FROM (SELECT status, count(*) n FROM public.restaurants GROUP BY 1) x),
    'folder_ids_length', (SELECT jsonb_object_agg(k, n) FROM (SELECT coalesce(cardinality(folder_ids), -1)::text k, count(*) n FROM public.restaurants GROUP BY 1) x),
    'folder_id_set', (SELECT count(*) FROM public.restaurants WHERE folder_id IS NOT NULL)),
  'shared', jsonb_build_object(
    'item_status', (SELECT jsonb_object_agg(coalesce(status, 'null'), n) FROM (SELECT status, count(*) n FROM public.shared_list_items GROUP BY 1) x),
    'max_items_per_shared_list', (SELECT max(n) FROM (SELECT count(*) n FROM public.shared_list_items GROUP BY list_id) x))
)) AS data_shape;