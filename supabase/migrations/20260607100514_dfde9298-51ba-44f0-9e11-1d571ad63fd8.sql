
-- Fix: function search_path mutable
ALTER FUNCTION public.classify_jst_sales_order(text, numeric, timestamp with time zone, text, timestamp with time zone, text, boolean) SET search_path = public;

-- Fix: anon should not execute SECURITY DEFINER admin/ops functions
REVOKE EXECUTE ON FUNCTION public.can_read_finance(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_write_finance(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.jst_cancel_all_running_syncs() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.jst_release_job_lock(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.jst_resync_shop_mappings_from_shops() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.jst_shop_mapping_audit() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.jst_try_lock_job(uuid, text, integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reclassify_jst_sales_orders_by_keys(text[], text[]) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_jst_sales_order_classification(integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.shops_sync_to_jst_mapping() FROM anon, PUBLIC;

-- Ensure authenticated + service_role still have access
GRANT EXECUTE ON FUNCTION public.can_read_finance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_finance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.jst_cancel_all_running_syncs() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.jst_release_job_lock(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.jst_resync_shop_mappings_from_shops() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.jst_shop_mapping_audit() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.jst_try_lock_job(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reclassify_jst_sales_orders_by_keys(text[], text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_jst_sales_order_classification(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shops_sync_to_jst_mapping() TO authenticated, service_role;
