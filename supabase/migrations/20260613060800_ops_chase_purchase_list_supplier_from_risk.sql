CREATE OR REPLACE FUNCTION public.ops_chase_purchase_list()
 RETURNS TABLE(sku text, style_no text, supplier_name text, pending_qty numeric, intransit_qty numeric, missing_date_qty numeric, late_order_qty numeric, urge_supplier_qty numeric, closed_short_qty numeric, raw_gap numeric, return_in_transit numeric, resale_rate numeric, return_offset numeric, final_gap numeric, earliest_pay_time timestamp with time zone, is_quantui boolean, quantui_supplier text, quantui_remark text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rate numeric;
BEGIN
  IF NOT (public.has_ops_role(v_uid, 'admin'::public.ops_role_code)
       OR public.has_ops_role(v_uid, 'ops'::public.ops_role_code)) THEN
    RAISE EXCEPTION '仅管理员或运营角色可访问采购缺口' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(
    (SELECT p.param_value::numeric FROM public.ops_params p WHERE p.param_key = 'chase_resale_rate'),
    0.95) INTO v_rate;

  RETURN QUERY
  WITH core AS (
    SELECT * FROM public.ops_chase_match_snapshot
  ),
  by_sku AS (
    SELECT c.sku AS c_sku, max(c.style_no) AS c_style_no, max(c.supplier_name) AS c_supplier_name,
           sum(c.match_qty) AS pending_qty,
           coalesce(sum(c.match_qty) FILTER (WHERE c.category = 'in_transit'), 0) AS intransit_qty,
           coalesce(sum(c.match_qty) FILTER (WHERE c.category = 'in_transit' AND c.missing_delivery_date), 0) AS missing_date_qty,
           coalesce(sum(c.match_qty) FILTER (WHERE c.category = 'late_order'), 0) AS late_order_qty,
           coalesce(sum(c.match_qty) FILTER (WHERE c.category = 'urge_supplier'), 0) AS urge_supplier_qty,
           coalesce(sum(c.match_qty) FILTER (WHERE c.category = 'closed_short'), 0) AS closed_short_qty,
           coalesce(sum(c.match_qty) FILTER (WHERE c.category = 'gap'), 0) AS raw_gap,
           min(c.pay_time) AS earliest_pay_time
    FROM core c
    GROUP BY c.sku
  ),
  ret AS (
    SELECT i.sku_id AS r_sku, sum(coalesce(i.qty, 0)) AS applied
    FROM public.jst_refund_order_items i
    JOIN public.jst_refund_orders ro ON ro.as_id = i.as_id
    WHERE coalesce(ro.status, '') <> 'Cancelled'
      AND coalesce(ro.type, '') LIKE '%退货%'
    GROUP BY 1
  ),
  rec AS (
    SELECT i.sku_id AS r_sku, sum(coalesce(i.qty, 0)) AS received
    FROM public.jst_aftersale_received_items i
    GROUP BY 1
  ),
  -- 已回填供应商的风险订单（含SKU前缀兜底解析出的供应商），按SKU取一个，供采购缺口补显示
  sro AS (
    SELECT s.sku_code AS s_sku, max(nullif(s.supplier_name, '')) AS s_supplier
    FROM public.shipping_risk_orders s
    WHERE coalesce(s.supplier_name, '') <> '' AND coalesce(s.sku_code, '') <> ''
    GROUP BY s.sku_code
  ),
  qt AS MATERIALIZED (
    SELECT q.sku AS q_sku, q.original_supplier_name, q.remark
    FROM public.ops_chase_quantui_skus() q
  )
  SELECT b.c_sku,
         coalesce(nullif(mm.m_style, ''), b.c_style_no) AS style_no,
         coalesce(mm.m_supplier, sro.s_supplier, b.c_supplier_name) AS supplier_name,
         b.pending_qty, b.intransit_qty, b.missing_date_qty,
         b.late_order_qty, b.urge_supplier_qty, b.closed_short_qty, b.raw_gap,
         greatest(coalesce(r.applied, 0) - coalesce(rc.received, 0), 0) AS return_in_transit,
         v_rate,
         round(greatest(coalesce(r.applied, 0) - coalesce(rc.received, 0), 0) * v_rate, 2) AS return_offset,
         greatest(b.raw_gap + b.closed_short_qty - greatest(coalesce(r.applied, 0) - coalesce(rc.received, 0), 0) * v_rate, 0) AS final_gap,
         b.earliest_pay_time,
         (qt.q_sku IS NOT NULL) AS is_quantui,
         qt.original_supplier_name AS quantui_supplier,
         qt.remark AS quantui_remark
  FROM by_sku b
  LEFT JOIN LATERAL (
    SELECT s.style_no AS m_style,
           coalesce(p.supplier_name_snapshot, sup.name) AS m_supplier
    FROM public.ops_skus s
    LEFT JOIN public.ops_products p ON p.id = s.product_id
    LEFT JOIN public.ops_suppliers sup ON sup.id = coalesce(s.supplier_id, p.supplier_id)
    WHERE s.sku_code = b.c_sku
    LIMIT 1
  ) mm ON true
  LEFT JOIN sro ON sro.s_sku = b.c_sku
  LEFT JOIN qt ON qt.q_sku = b.c_sku
  LEFT JOIN ret r ON r.r_sku = b.c_sku
  LEFT JOIN rec rc ON rc.r_sku = b.c_sku
  ORDER BY greatest(b.raw_gap + b.closed_short_qty - greatest(coalesce(r.applied, 0) - coalesce(rc.received, 0), 0) * v_rate, 0) DESC,
           b.raw_gap + b.closed_short_qty DESC, b.earliest_pay_time ASC;
END
$function$
