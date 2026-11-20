-- READ ONLY. Run in production right AFTER the five migrations (it needs the new columns, so it
-- errors before them: before migrating, run pre-migration-counts.sql instead).
-- Every value under "checks" must be true. Each number under "counts" must be at least the number
-- pre-migration-counts.sql returned just before migrating (people may add rows in between; none may drop).
WITH l AS (SELECT * FROM public.custom_lists)
SELECT jsonb_pretty(jsonb_build_object(
  'checks', jsonb_build_object(
    '#7 item insert/update checks the list owner',
      EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'custom_list_items'
              AND policyname = 'Users can insert their own custom list items' AND with_check LIKE '%custom_lists l%'),
    '#8 visibility + discovery_token columns',
      (SELECT count(*) = 2 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'custom_lists'
        AND column_name IN ('visibility', 'discovery_token')),
    '#8 content_reports.via_anonymous column',
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'content_reports' AND column_name = 'via_anonymous'),
    '#8 discovery functions present',
      to_regprocedure('public.get_discoverable_list(uuid)') IS NOT NULL AND to_regprocedure('public.get_list_discovery_preview(uuid)') IS NOT NULL
      AND to_regprocedure('public.report_discoverable_list(uuid,text,text)') IS NOT NULL AND to_regprocedure('public.can_view_custom_list(uuid,uuid)') IS NOT NULL,
    '#10 get_discovery_places present',
      to_regprocedure('public.get_discovery_places(text)') IS NOT NULL,
    '#13 list-photo uploads limited to own folder',
      EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can upload custom list images to own folder')
      AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Authenticated users can upload custom list images'),
    '#14 photo records only on own place/item',
      EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'restaurant_images'
              AND policyname = 'Users can insert their own images' AND with_check LIKE '%restaurants r%'),
    'signed-out visitors cannot call the new functions',
      coalesce(NOT has_function_privilege('anon', 'public.get_discovery_places(text)', 'EXECUTE')
           AND NOT has_function_privilege('anon', 'public.get_discoverable_list(uuid)', 'EXECUTE'), false),
    'every existing list kept profile visibility',
      (SELECT count(*) FILTER (WHERE visibility IS DISTINCT FROM 'profile') = 0 FROM l),
    'every list has its own discovery token',
      (SELECT count(DISTINCT discovery_token) = count(*) AND count(*) FILTER (WHERE discovery_token IS NULL) = 0 FROM l)),
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
)) AS post_migration;
