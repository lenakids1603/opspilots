-- Restrict SECURITY DEFINER functions that should not be publicly callable.
-- get_email_by_identifier is intentionally callable by anon (login flow) and stays as-is.

REVOKE ALL ON FUNCTION public.backfill_sales_summary_from_legacy(timestamp with time zone, timestamp with time zone, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_sales_summary_from_legacy(timestamp with time zone, timestamp with time zone, integer) TO service_role;

REVOKE ALL ON FUNCTION public.refresh_sales_summaries_for_order_items(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_sales_summaries_for_order_items(text[]) TO service_role;