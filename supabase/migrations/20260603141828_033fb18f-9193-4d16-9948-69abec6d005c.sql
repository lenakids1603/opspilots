
ALTER TABLE public.jst_sales_orders
  ADD COLUMN IF NOT EXISTS internal_order_type text,
  ADD COLUMN IF NOT EXISTS internal_order_type_name text,
  ADD COLUMN IF NOT EXISTS internal_order_type_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_jst_sales_orders_internal_type
  ON public.jst_sales_orders(internal_order_type);

-- Classification function (uses only order fields; refund correlation done via separate refresh)
CREATE OR REPLACE FUNCTION public.classify_jst_sales_order(
  _status text,
  _paid_amount numeric,
  _pay_time timestamptz,
  _io_id text,
  _io_date timestamptz,
  _l_id text,
  _has_refund boolean DEFAULT false
)
RETURNS TABLE(code text, name text)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_cancelled boolean;
  v_paid boolean;
  v_shipped boolean;
BEGIN
  v_cancelled := lower(coalesce(_status,'')) IN ('cancelled','canceled','cancel','已取消');
  v_paid := coalesce(_paid_amount,0) > 0 OR _pay_time IS NOT NULL;
  v_shipped := coalesce(_io_id,'') <> '' OR _io_date IS NOT NULL OR coalesce(_l_id,'') <> '';

  IF v_cancelled AND NOT v_paid AND NOT v_shipped THEN
    RETURN QUERY SELECT 'unpaid_cancelled'::text, '未付款取消'::text; RETURN;
  END IF;
  IF v_cancelled AND v_paid AND NOT v_shipped THEN
    RETURN QUERY SELECT 'paid_cancelled_before_ship'::text, '付款后未发货退款'::text; RETURN;
  END IF;
  IF (v_cancelled OR _has_refund) AND v_shipped THEN
    RETURN QUERY SELECT 'returned_after_ship'::text, '发货后退货'::text; RETURN;
  END IF;
  IF v_shipped THEN
    RETURN QUERY SELECT 'shipped'::text, '已发货'::text; RETURN;
  END IF;
  IF v_paid AND NOT v_shipped AND NOT v_cancelled THEN
    RETURN QUERY SELECT 'paid_pending_ship'::text, '已付款待发货'::text; RETURN;
  END IF;
  RETURN QUERY SELECT 'unknown'::text, '待识别'::text;
END;
$$;

-- Backfill / refresh function: recompute classification for orders, optionally joining refund table
CREATE OR REPLACE FUNCTION public.refresh_jst_sales_order_classification(_limit integer DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF NOT public.is_ops_internal(auth.uid()) THEN
    RAISE EXCEPTION '无权限';
  END IF;

  WITH src AS (
    SELECT o.id, o.status, o.paid_amount, o.pay_time, o.io_id, o.io_date, o.l_id,
           EXISTS(
             SELECT 1 FROM public.jst_refund_orders r
             WHERE (r.o_id = o.jst_o_id OR r.so_id = o.so_id)
               AND coalesce(r.refund_amount,0) > 0
           ) AS has_refund
    FROM public.jst_sales_orders o
    LIMIT COALESCE(_limit, 2147483647)
  ),
  cls AS (
    SELECT s.id, c.code, c.name
    FROM src s, LATERAL public.classify_jst_sales_order(
      s.status, s.paid_amount, s.pay_time, s.io_id, s.io_date, s.l_id, s.has_refund
    ) c
  ),
  upd AS (
    UPDATE public.jst_sales_orders o
    SET internal_order_type = cls.code,
        internal_order_type_name = cls.name,
        internal_order_type_updated_at = now()
    FROM cls
    WHERE o.id = cls.id
      AND (o.internal_order_type IS DISTINCT FROM cls.code
           OR o.internal_order_type_name IS DISTINCT FROM cls.name)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_jst_sales_order_classification(integer) TO authenticated;
