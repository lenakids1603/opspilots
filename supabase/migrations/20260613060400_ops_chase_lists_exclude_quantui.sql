-- 催货页劝退/SKU主档改造:补登记已上线对象(2026-06-13)
--
-- 本文件:ops_chase_supplier_list() 与 ops_chase_unmatched_list() 改版 —— 二者均
--   经 ops_chase_quantui_skus() 反连接(NOT EXISTS)排除劝退款,不再向供应商催货/
--   未匹配清单展示。返回类型未变,用 create or replace。函数体由生产库
--   pg_get_functiondef 原样导出。
--
-- 依赖 ops_chase_quantui_skus()(见 20260613060100),故排在其后。
-- 授权与生产一致:REVOKE public/anon + GRANT authenticated/service_role。

-- ============ 1. 催供应商清单(排除劝退款) ============
CREATE OR REPLACE FUNCTION public.ops_chase_supplier_list()
 RETURNS TABLE(supplier_id uuid, supplier_name text, sku text, style_no text, total_qty numeric, overdue_qty numeric, due24_qty numeric, due48_qty numeric, due72_qty numeric, later_qty numeric, po_count integer, max_overdue_days integer, po_details jsonb, product_name text, image_url text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_supplier uuid;
BEGIN
  IF public.is_ops_internal(v_uid) THEN
    v_supplier := NULL;  -- 内部人员看全部
  ELSE
    v_supplier := public.supplier_id_of(v_uid);  -- 供应商账号只看自己
    IF v_supplier IS NULL THEN
      RAISE EXCEPTION '无权访问催货列表' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  WITH qt AS MATERIALIZED (
    SELECT q.sku AS q_sku FROM public.ops_chase_quantui_skus() q
  ),
  src AS (
    SELECT s.supplier_id AS sup_id, s.supplier_name AS sup_name, s.sku AS s_sku,
           s.style_no AS s_style, s.external_po_id AS s_po, s.delivery_date AS s_dd,
           s.match_qty AS s_qty,
           CASE WHEN s.delivery_date IS NOT NULL
                THEN greatest((now() AT TIME ZONE 'Asia/Shanghai')::date - (s.delivery_date AT TIME ZONE 'Asia/Shanghai')::date, 0)
                ELSE 0 END AS od,
           CASE
             WHEN s.latest_ship_time <= now() THEN 'overdue'
             WHEN s.latest_ship_time <= now() + interval '24 hours' THEN 'due24'
             WHEN s.latest_ship_time <= now() + interval '48 hours' THEN 'due48'
             WHEN s.latest_ship_time <= now() + interval '72 hours' THEN 'due72'
             ELSE 'later'
           END AS u
    FROM public.ops_chase_match_snapshot s
    WHERE s.category = 'urge_supplier'
      AND (v_supplier IS NULL OR s.supplier_id = v_supplier)
      AND s.latest_ship_time IS NOT NULL
      AND s.latest_ship_time <= now() + interval '7 days'
      AND NOT EXISTS (SELECT 1 FROM qt WHERE qt.q_sku = s.sku)
  ),
  per_po AS (
    SELECT c.sup_id, c.sup_name, c.s_sku, max(c.s_style) AS s_style,
           c.s_po, c.s_dd, max(c.od) AS overdue_days,
           sum(c.s_qty) AS qty,
           sum(c.s_qty) FILTER (WHERE c.u = 'overdue') AS q_overdue,
           sum(c.s_qty) FILTER (WHERE c.u = 'due24') AS q_due24,
           sum(c.s_qty) FILTER (WHERE c.u = 'due48') AS q_due48,
           sum(c.s_qty) FILTER (WHERE c.u = 'due72') AS q_due72,
           sum(c.s_qty) FILTER (WHERE c.u = 'later') AS q_later
    FROM src c
    GROUP BY c.sup_id, c.sup_name, c.s_sku, c.s_po, c.s_dd
  ),
  by_sku AS (
    SELECT p.sup_id AS r_supplier_id, p.sup_name AS r_supplier_name,
           p.s_sku AS r_sku, max(p.s_style) AS r_style_no,
           sum(p.qty) AS r_total,
           coalesce(sum(p.q_overdue), 0) AS r_overdue, coalesce(sum(p.q_due24), 0) AS r_due24,
           coalesce(sum(p.q_due48), 0) AS r_due48, coalesce(sum(p.q_due72), 0) AS r_due72,
           coalesce(sum(p.q_later), 0) AS r_later,
           count(DISTINCT p.s_po)::int AS r_po_count, max(p.overdue_days) AS r_max_overdue,
           jsonb_agg(jsonb_build_object(
             'po_id', p.s_po,
             'delivery_date', (p.s_dd AT TIME ZONE 'Asia/Shanghai')::date,
             'overdue_days', p.overdue_days,
             'qty', p.qty) ORDER BY p.s_dd) AS r_po_details
    FROM per_po p
    GROUP BY p.sup_id, p.sup_name, p.s_sku
  )
  SELECT b.r_supplier_id, b.r_supplier_name, b.r_sku, b.r_style_no,
         b.r_total, b.r_overdue, b.r_due24, b.r_due48, b.r_due72, b.r_later,
         b.r_po_count, b.r_max_overdue, b.r_po_details,
         coalesce(nullif(pr.product_name, ''),
                  CASE WHEN pr.name <> pr.code THEN pr.name END),
         coalesce(nullif(pr.main_image_url, ''), nullif(pr.external_image_url, ''))
  FROM by_sku b
  LEFT JOIN public.ops_products pr ON pr.code = b.r_style_no
  ORDER BY b.r_overdue DESC, b.r_max_overdue DESC, b.r_total DESC;
END
$function$;

REVOKE ALL ON FUNCTION public.ops_chase_supplier_list() FROM public;
REVOKE ALL ON FUNCTION public.ops_chase_supplier_list() FROM anon;
GRANT EXECUTE ON FUNCTION public.ops_chase_supplier_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_chase_supplier_list() TO service_role;

-- ============ 2. 供应商未匹配清单(排除劝退款) ============
CREATE OR REPLACE FUNCTION public.ops_chase_unmatched_list()
 RETURNS TABLE(style_no text, product_name text, image_url text, total_qty numeric, overdue_qty numeric, due24_qty numeric, due48_qty numeric, due72_qty numeric, later_qty numeric, order_count bigint, shop_names text[], earliest_ship_time timestamp with time zone, sku_details jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_ops_internal(auth.uid()) THEN
    RAISE EXCEPTION '仅内部人员可访问' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH qt AS MATERIALIZED (
    SELECT q.sku AS q_sku FROM public.ops_chase_quantui_skus() q
  ),
  matched AS MATERIALIZED (
    SELECT DISTINCT s.item_unique_key
    FROM public.ops_chase_match_snapshot s
    WHERE s.category IN ('urge_supplier', 'late_order', 'in_transit', 'closed_short')
      AND coalesce(s.supplier_name, '') <> ''
  ),
  base AS (
    SELECT coalesce(nullif(r.style_no, ''), nullif(r.sku_code, ''), '(无款号)') AS s_no,
           coalesce(nullif(r.sku_code, ''), '(无SKU)') AS sku,
           r.sku_name, r.qty, r.o_id, r.latest_ship_time,
           coalesce(nullif(r.shop_name, ''), r.shop_id, '') AS shop
    FROM public.shipping_risk_orders r
    LEFT JOIN matched m ON m.item_unique_key = r.item_unique_key
    WHERE r.order_status IN ('Question', 'WaitConfirm')
      AND coalesce(r.qty, 0) > 0
      AND (coalesce(r.supplier_name, '') = '' OR coalesce(r.style_no, '') ~ '^\d{12,}')
      AND m.item_unique_key IS NULL
      AND r.latest_ship_time IS NOT NULL
      AND r.latest_ship_time <= now() + interval '7 days'
      AND NOT EXISTS (SELECT 1 FROM qt WHERE qt.q_sku = r.sku_code)
      AND (
        coalesce(r.style_no, '') ~ '^\d{12,}'
        OR EXISTS (
          SELECT 1 FROM public.purchase_order_items poi
          JOIN public.purchase_orders po2 ON po2.id = poi.purchase_order_id
          WHERE (poi.style_no = coalesce(nullif(r.style_no, ''), r.sku_code)
                 OR (coalesce(r.sku_code, '') <> '' AND poi.sku_no = r.sku_code))
            AND coalesce(po2.status, '') NOT IN ('Delete', 'Cancelled')
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.ops_chase_excluded_styles e
        WHERE e.scope IN ('chase', 'all')
          AND (e.style_no IS NULL OR lower(e.style_no) = lower(coalesce(r.style_no, '')))
          AND (e.sku IS NULL OR e.sku = coalesce(r.sku_code, ''))
      )
  ),
  by_sku AS (
    SELECT b.s_no, b.sku, max(coalesce(b.sku_name, '')) AS sku_name,
           sum(b.qty) AS qty,
           coalesce(sum(b.qty) FILTER (WHERE b.latest_ship_time <= now()), 0) AS overdue,
           coalesce(sum(b.qty) FILTER (WHERE b.latest_ship_time > now()
             AND b.latest_ship_time <= now() + interval '24 hours'), 0) AS due24,
           coalesce(sum(b.qty) FILTER (WHERE b.latest_ship_time > now() + interval '24 hours'
             AND b.latest_ship_time <= now() + interval '48 hours'), 0) AS due48,
           coalesce(sum(b.qty) FILTER (WHERE b.latest_ship_time > now() + interval '48 hours'
             AND b.latest_ship_time <= now() + interval '72 hours'), 0) AS due72,
           coalesce(sum(b.qty) FILTER (WHERE b.latest_ship_time > now() + interval '72 hours'), 0) AS later
    FROM base b
    GROUP BY b.s_no, b.sku
  ),
  by_style AS (
    SELECT b.s_no,
           count(DISTINCT b.o_id) AS orders,
           array_agg(DISTINCT b.shop) FILTER (WHERE b.shop <> '') AS shops,
           min(b.latest_ship_time) AS earliest
    FROM base b
    GROUP BY b.s_no
  )
  SELECT k.s_no,
         coalesce(nullif(p.product_name, ''), CASE WHEN p.name <> p.code THEN p.name END),
         coalesce(nullif(p.main_image_url, ''), nullif(p.external_image_url, ''), si.img),
         sum(k.qty), sum(k.overdue), sum(k.due24), sum(k.due48), sum(k.due72), sum(k.later),
         st.orders, st.shops, st.earliest,
         jsonb_agg(jsonb_build_object(
           'sku', k.sku, 'sku_name', k.sku_name, 'qty', k.qty, 'overdue_qty', k.overdue
         ) ORDER BY k.overdue DESC, k.qty DESC)
  FROM by_sku k
  JOIN by_style st ON st.s_no = k.s_no
  LEFT JOIN public.ops_products p ON p.code = k.s_no
  LEFT JOIN LATERAL (
    -- 款式图兜底：先按款号找，再按该款下任一SKU找
    SELECT t.img
    FROM (
      SELECT coalesce(nullif(s.sku_image_url, ''), nullif(s.external_image_url, '')) AS img
      FROM public.ops_skus s
      WHERE s.style_no = k.s_no
      UNION ALL
      SELECT coalesce(nullif(s.sku_image_url, ''), nullif(s.external_image_url, ''))
      FROM public.ops_skus s
      WHERE s.sku_code IN (SELECT k2.sku FROM by_sku k2 WHERE k2.s_no = k.s_no)
    ) t
    WHERE t.img IS NOT NULL
    LIMIT 1
  ) si ON true
  GROUP BY k.s_no, p.product_name, p.name, p.code, p.main_image_url, p.external_image_url, si.img,
           st.orders, st.shops, st.earliest
  ORDER BY sum(k.overdue) DESC, sum(k.qty) DESC, k.s_no;
END
$function$;

REVOKE ALL ON FUNCTION public.ops_chase_unmatched_list() FROM public;
REVOKE ALL ON FUNCTION public.ops_chase_unmatched_list() FROM anon;
GRANT EXECUTE ON FUNCTION public.ops_chase_unmatched_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_chase_unmatched_list() TO service_role;
