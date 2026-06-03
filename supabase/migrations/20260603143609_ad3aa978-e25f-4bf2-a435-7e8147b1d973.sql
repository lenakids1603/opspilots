
CREATE OR REPLACE FUNCTION public.refresh_jst_sales_order_classification(_limit integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count integer := 0;
BEGIN
  -- 允许 SQL Editor / service_role / Edge Function（auth.uid() 为空）执行；
  -- 前端登录用户必须是内部账号。
  IF auth.uid() IS NOT NULL AND NOT public.is_ops_internal(auth.uid()) THEN
    RAISE EXCEPTION '无权限';
  END IF;

  WITH src AS (
    SELECT o.id, o.status, o.paid_amount, o.pay_time, o.io_id, o.io_date, o.l_id,
           (
             EXISTS(SELECT 1 FROM public.jst_refund_orders r
                    WHERE (r.o_id = o.jst_o_id OR (o.so_id IS NOT NULL AND r.so_id = o.so_id))
                      AND coalesce(r.refund_amount,0) > 0)
             OR
             EXISTS(SELECT 1 FROM public.jst_aftersale_received_orders a
                    WHERE (a.o_id = o.jst_o_id OR (o.so_id IS NOT NULL AND a.so_id = o.so_id)))
           ) AS has_refund
    FROM public.jst_sales_orders o
    ORDER BY (o.internal_order_type IS NULL) DESC,
             o.internal_order_type_updated_at NULLS FIRST,
             o.modified_time DESC NULLS LAST
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
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reclassify_jst_sales_orders_by_keys(_o_ids text[] DEFAULT NULL::text[], _so_ids text[] DEFAULT NULL::text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_ops_internal(auth.uid()) THEN
    RAISE EXCEPTION '无权限';
  END IF;
  IF (_o_ids IS NULL OR array_length(_o_ids,1) IS NULL)
     AND (_so_ids IS NULL OR array_length(_so_ids,1) IS NULL) THEN
    RETURN 0;
  END IF;

  WITH src AS (
    SELECT o.id, o.status, o.paid_amount, o.pay_time, o.io_id, o.io_date, o.l_id,
           (
             EXISTS(SELECT 1 FROM public.jst_refund_orders r
                    WHERE (r.o_id = o.jst_o_id OR (o.so_id IS NOT NULL AND r.so_id = o.so_id))
                      AND coalesce(r.refund_amount,0) > 0)
             OR
             EXISTS(SELECT 1 FROM public.jst_aftersale_received_orders a
                    WHERE (a.o_id = o.jst_o_id OR (o.so_id IS NOT NULL AND a.so_id = o.so_id)))
           ) AS has_refund
    FROM public.jst_sales_orders o
    WHERE (_o_ids IS NOT NULL AND o.jst_o_id = ANY(_o_ids))
       OR (_so_ids IS NOT NULL AND o.so_id = ANY(_so_ids))
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
$function$;

REVOKE ALL ON FUNCTION public.refresh_jst_sales_order_classification(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_jst_sales_order_classification(integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reclassify_jst_sales_orders_by_keys(text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reclassify_jst_sales_orders_by_keys(text[], text[]) TO authenticated, service_role;
