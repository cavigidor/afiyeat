-- Read-only checks for Schema A. Neither query changes anything.

-- PRE-CHECK (before applying). Expect: every "present" column false, the
-- stack columns true, and no existing constraint or function name clash.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='custom_lists' AND column_name='visibility')           AS stack_visibility_present,
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='can_view_custom_list')          AS stack_can_view_present,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='custom_lists' AND column_name='config')               AS a_config_present,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='custom_list_items' AND column_name='details')         AS a_details_present,
  EXISTS (SELECT 1 FROM information_schema.tables  WHERE table_schema='public' AND table_name='user_list_settings')                                  AS a_settings_table_present,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
     AND p.proname IN ('create_list_from_preset','patch_item_details','patch_restaurant_details','patch_list_config','patch_restaurants_config','apply_checklist_op',
                       'lists_v2_key_ok','lists_v2_details_ok','lists_v2_config_ok','lists_v2_apply_ops'))                                   AS a_functions_present,
  (SELECT count(*) FROM public.custom_lists)       AS lists_before,
  (SELECT count(*) FROM public.custom_list_items)  AS items_before,
  (SELECT count(*) FROM public.restaurants)        AS restaurants_before,
  -- Client-chosen ids: is an explicit id insertable by signed-in users?
  has_column_privilege('authenticated', 'public.custom_list_items', 'id', 'INSERT') AS items_id_insertable,
  has_column_privilege('authenticated', 'public.custom_lists',      'id', 'INSERT') AS lists_id_insertable,
  has_column_privilege('authenticated', 'public.restaurants',       'id', 'INSERT') AS restaurants_id_insertable,
  has_column_privilege('authenticated', 'public.shared_list_items', 'id', 'INSERT') AS shared_items_id_insertable;

-- POST-CHECK (after applying). Expect: 10 functions, 6 of them not SECURITY
-- DEFINER, row counts unchanged, every existing row at its default.
SELECT
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
     AND p.proname IN ('create_list_from_preset','patch_item_details','patch_restaurant_details','patch_list_config','patch_restaurants_config','apply_checklist_op',
                       'lists_v2_key_ok','lists_v2_details_ok','lists_v2_config_ok','lists_v2_apply_ops'))                                   AS a_functions_present,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef
     AND p.proname IN ('create_list_from_preset','patch_item_details','patch_restaurant_details','patch_list_config','patch_restaurants_config','apply_checklist_op')) AS a_security_definer_count,
  (SELECT count(*) FROM public.custom_lists)                                                       AS lists_after,
  (SELECT count(*) FROM public.custom_lists WHERE config <> '{}'::jsonb OR preset_key IS NOT NULL) AS lists_not_default,
  (SELECT count(*) FROM public.custom_list_items)                                                  AS items_after,
  (SELECT count(*) FROM public.custom_list_items WHERE details <> '{}'::jsonb OR is_favorite)      AS items_not_default,
  (SELECT count(*) FROM public.restaurants WHERE details <> '{}'::jsonb)                           AS restaurants_not_default,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_list_settings'::regclass)          AS settings_rls_on,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='user_list_settings')  AS settings_policies,
  pg_get_functiondef('public.custom_list_anonymous_view(uuid)'::regprocedure) NOT LIKE '%details%' AS anonymous_view_has_no_details;
