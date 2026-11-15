-- WITHDRAWN 2026-11-15. Do not run. Kept only as the regression target of baseline/tests/detect-stack.test.mjs.
-- It decides by policy names and substrings, so it reports "present" for states that are not (see tests D4-D6).
-- Replaced by queries/fingerprint-export.sql + baseline/detect-stack.mjs.
-- READ ONLY
-- Which of the five pending integration-stack migrations does production ALREADY contain?
-- Decided by the objects each one creates, not by migration history (hand-pasted files are not recorded).
-- "present" = every listed object exists; "absent" = none exists; "partial" = stop and investigate.
WITH checks(ord, migration, pr, object, present) AS (VALUES
  (1, '20261029120000_custom_list_items_owner_check', '#7',
      'items INSERT policy checks list ownership',
      EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'custom_list_items' AND cmd = 'INSERT'
               AND with_check ILIKE '%custom_lists%' AND with_check ILIKE '%auth.uid()%')),
  (2, '20261030120000_list_visibility_and_anonymous_discovery', '#8',
      'custom_lists.visibility column',
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'custom_lists' AND column_name = 'visibility')),
  (2, '20261030120000_list_visibility_and_anonymous_discovery', '#8',
      'function can_view_custom_list',
      to_regprocedure('public.can_view_custom_list(uuid, uuid)') IS NOT NULL),
  (2, '20261030120000_list_visibility_and_anonymous_discovery', '#8',
      'function get_discoverable_list',
      to_regprocedure('public.get_discoverable_list(uuid)') IS NOT NULL),
  (3, '20261109120000_discovery_places', '#10',
      'function get_discovery_places',
      EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_discovery_places')),
  (4, '20261109180000_custom_list_images_owner_folder', '#13',
      'storage INSERT policy for custom-list-images checks the owner folder',
      EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd IN ('INSERT', 'ALL')
               AND with_check ILIKE '%custom-list-images%' AND with_check ILIKE '%foldername%')),
  (5, '20261111120000_photo_records_owner_check', '#14',
      'custom_list_item_images INSERT policy checks the parent item owner',
      EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'custom_list_item_images' AND cmd IN ('INSERT', 'ALL')
               AND with_check ILIKE '%custom_list_items%'))
)
SELECT ord, migration, pr,
       CASE WHEN bool_and(present) THEN 'present' WHEN NOT bool_or(present) THEN 'absent' ELSE 'partial' END AS in_production,
       string_agg(object || ': ' || present, '; ' ORDER BY object) AS evidence
  FROM checks GROUP BY ord, migration, pr ORDER BY ord;
