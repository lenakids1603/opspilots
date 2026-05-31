
REVOKE ALL ON FUNCTION public.recalc_purchase_order_aggregates(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_purchase_order_aggregates(uuid) TO service_role;
