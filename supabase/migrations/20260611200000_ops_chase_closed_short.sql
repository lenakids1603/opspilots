-- 催货匹配增加"厂家已结单"判定（2026-06-11，老板确认口径）
--
-- 业务规则：按订单采购下，供应商实际交付量受面料限制会偏离采购量。
-- 采购单在聚水潭变为 Finished（已完成）即代表供应商交付结束，不会再补交，
-- 其未收货数量不是"在途"，而是"永久性少交"。
-- 原口径把 Finished 单的未收量当可催供给，导致 urge_supplier 中约 88% 是
-- 不可能催到的货（生产 2,9xx 件中约 2,5xx 件匹配的是 Finished 单）。
--
-- 变更内容：
--   1) ops_chase_match_core 供给侧仅取 status IN ('Confirmed','Finished')
--      （生产仅存在 Confirmed/Finished/Delete 三种状态；Delete 继续排除）。
--      同一 SKU 的供给排序改为：Confirmed 在前（按协议到货日 FIFO），
--      Finished 在后 —— 即需求优先吃可催的 Confirmed 余量，吃不完的部分
--      落到 Finished 余量上，分类为新类别 closed_short（厂家已结单少交）。
--      urge_supplier / late_order / in_transit 仅由 Confirmed 单产生。
--   2) ops_chase_supplier_list / ops_chase_urgency_summary 过滤条件本就是
--      category='urge_supplier'，口径随之自动收窄，无需改动。
--   3) ops_chase_purchase_list：intransit_qty 自动只含 Confirmed 未收量；
--      新增 closed_short_qty 列，且 final_gap = max(raw_gap + closed_short
--      − 在途退货×可再售率, 0) —— 已结单少交是永久缺口，必须计入补单量。
--   4) 新增 ops_chase_closed_short_list()：按 SKU 汇总厂家已结单少交，
--      供前端"补单决策"页签使用（内部用户可见）。
--
-- 本文件用 -- @@SPLIT@@ 注释分块，便于 Management API 分段执行（请求体≤4KB）。

-- @@SPLIT@@ ============ 1. FIFO 匹配核心：Confirmed 优先 + closed_short ============
-- 签名不变（15 列），CREATE OR REPLACE 即可，权限沿用。
CREATE OR REPLACE FUNCTION public.ops_chase_match_core()
RETURNS TABLE (
  sku text, style_no text, category text, match_qty numeric,
  external_po_id text, supplier_id uuid, supplier_name text,
  delivery_date timestamptz, overdue_days int, missing_delivery_date boolean,
  item_unique_key text, o_id text, pay_time timestamptz, latest_ship_time timestamptz,
  urgency text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH demand AS (
  SELECT r.item_unique_key, r.o_id, r.sku_code AS sku, r.style_no,
         r.qty::numeric AS qty,
         coalesce(r.pay_time, r.order_created_at, r.created_at) AS pay_time,
         r.latest_ship_time,
         sum(r.qty::numeric) OVER (
           PARTITION BY r.sku_code
           ORDER BY coalesce(r.pay_time, r.order_created_at, r.created_at), r.item_unique_key
         ) AS d_end
  FROM public.shipping_risk_orders r
  WHERE r.order_status IN ('Question', 'WaitConfirm')
    AND coalesce(r.qty, 0) > 0
    AND coalesce(r.sku_code, '') <> ''
),
supply AS (
  SELECT poi.sku_no AS sku, po.external_po_id, po.supplier_id, po.supplier_name,
         poi.delivery_date, po.status AS po_status,
         greatest(coalesce(poi.purchase_qty, 0) - coalesce(poi.received_qty, 0), 0)::numeric AS remaining,
         sum(greatest(coalesce(poi.purchase_qty, 0) - coalesce(poi.received_qty, 0), 0)::numeric) OVER (
           PARTITION BY poi.sku_no
           ORDER BY (po.status = 'Finished'), poi.delivery_date ASC NULLS LAST, poi.id
         ) AS s_end
  FROM public.purchase_order_items poi
  JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
  WHERE po.status IN ('Confirmed', 'Finished')
    AND coalesce(poi.sku_no, '') <> ''
    AND coalesce(poi.purchase_qty, 0) - coalesce(poi.received_qty, 0) > 0
),
matched AS (
  SELECT d.sku, d.style_no, d.item_unique_key, d.o_id, d.pay_time, d.latest_ship_time,
         s.external_po_id, s.supplier_id, s.supplier_name, s.delivery_date, s.po_status,
         least(d.d_end, s.s_end) - greatest(d.d_end - d.qty, s.s_end - s.remaining) AS match_qty
  FROM demand d
  JOIN supply s ON s.sku = d.sku
  WHERE least(d.d_end, s.s_end) > greatest(d.d_end - d.qty, s.s_end - s.remaining)
),
unioned AS (
  SELECT m.sku, m.style_no,
    CASE
      WHEN m.po_status = 'Finished' THEN 'closed_short'
      WHEN m.delivery_date IS NULL THEN 'in_transit'
      WHEN m.latest_ship_time IS NOT NULL AND m.delivery_date > m.latest_ship_time THEN 'late_order'
      WHEN (m.delivery_date AT TIME ZONE 'Asia/Shanghai')::date < (now() AT TIME ZONE 'Asia/Shanghai')::date THEN 'urge_supplier'
      ELSE 'in_transit'
    END AS category,
    m.match_qty, m.external_po_id, m.supplier_id, m.supplier_name, m.delivery_date,
    CASE WHEN m.delivery_date IS NOT NULL
         THEN greatest((now() AT TIME ZONE 'Asia/Shanghai')::date - (m.delivery_date AT TIME ZONE 'Asia/Shanghai')::date, 0)
         ELSE 0 END AS overdue_days,
    (m.delivery_date IS NULL) AS missing_delivery_date,
    m.item_unique_key, m.o_id, m.pay_time, m.latest_ship_time
  FROM matched m
  UNION ALL
  SELECT d.sku, d.style_no, 'gap', d.qty - coalesce(mm.mq, 0),
         NULL, NULL, NULL, NULL, 0, false,
         d.item_unique_key, d.o_id, d.pay_time, d.latest_ship_time
  FROM demand d
  LEFT JOIN (SELECT m2.item_unique_key, sum(m2.match_qty) AS mq FROM matched m2 GROUP BY 1) mm
    USING (item_unique_key)
  WHERE d.qty - coalesce(mm.mq, 0) > 0
)
SELECT u.*,
  CASE
    WHEN u.latest_ship_time IS NULL THEN 'later'
    WHEN u.latest_ship_time <= now() THEN 'overdue'
    WHEN u.latest_ship_time <= now() + interval '24 hours' THEN 'due24'
    WHEN u.latest_ship_time <= now() + interval '48 hours' THEN 'due48'
    WHEN u.latest_ship_time <= now() + interval '72 hours' THEN 'due72'
    ELSE 'later'
  END AS urgency
FROM unioned u
$$;

-- @@SPLIT@@ ============ 2. 接口B：催采购（closed_short 计入最终缺口） ============
DROP FUNCTION IF EXISTS public.ops_chase_purchase_list();

CREATE FUNCTION public.ops_chase_purchase_list()
RETURNS TABLE (
  sku text, style_no text, supplier_name text,
  pending_qty numeric, intransit_qty numeric, missing_date_qty numeric,
  late_order_qty numeric, urge_supplier_qty numeric, closed_short_qty numeric,
  raw_gap numeric, return_in_transit numeric, resale_rate numeric,
  return_offset numeric, final_gap numeric, earliest_pay_time timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rate numeric;
BEGIN
  IF NOT (public.has_ops_role(v_uid, 'admin'::public.ops_role_code)
       OR public.has_ops_role(v_uid, 'ops'::public.ops_role_code)) THEN
    RAISE EXCEPTION '仅限管理员/采购角色访问催采购清单' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(
    (SELECT p.param_value::numeric FROM public.ops_params p WHERE p.param_key = 'chase_resale_rate'),
    0.95) INTO v_rate;

  RETURN QUERY
  WITH core AS (
    SELECT * FROM public.ops_chase_match_core()
  ),
  by_sku AS (
    SELECT c.sku, max(c.style_no) AS style_no, max(c.supplier_name) AS supplier_name,
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
    SELECT i.sku_id AS sku, sum(coalesce(i.qty, 0)) AS applied
    FROM public.jst_refund_order_items i
    JOIN public.jst_refund_orders ro ON ro.as_id = i.as_id
    WHERE coalesce(ro.status, '') <> 'Cancelled'
      AND coalesce(ro.type, '') LIKE '%退货%'
    GROUP BY 1
  ),
  rec AS (
    SELECT i.sku_id AS sku, sum(coalesce(i.qty, 0)) AS received
    FROM public.jst_aftersale_received_items i
    GROUP BY 1
  )
  SELECT b.sku, b.style_no, b.supplier_name,
         b.pending_qty, b.intransit_qty, b.missing_date_qty,
         b.late_order_qty, b.urge_supplier_qty, b.closed_short_qty, b.raw_gap,
         greatest(coalesce(r.applied, 0) - coalesce(rc.received, 0), 0) AS return_in_transit,
         v_rate,
         round(greatest(coalesce(r.applied, 0) - coalesce(rc.received, 0), 0) * v_rate, 2) AS return_offset,
         greatest(b.raw_gap + b.closed_short_qty - greatest(coalesce(r.applied, 0) - coalesce(rc.received, 0), 0) * v_rate, 0) AS final_gap,
         b.earliest_pay_time
  FROM by_sku b
  LEFT JOIN ret r ON r.sku = b.sku
  LEFT JOIN rec rc ON rc.sku = b.sku
  ORDER BY greatest(b.raw_gap + b.closed_short_qty - greatest(coalesce(r.applied, 0) - coalesce(rc.received, 0), 0) * v_rate, 0) DESC,
           b.raw_gap + b.closed_short_qty DESC, b.earliest_pay_time ASC;
END
$$;

REVOKE ALL ON FUNCTION public.ops_chase_purchase_list() FROM public;
REVOKE ALL ON FUNCTION public.ops_chase_purchase_list() FROM anon;
GRANT EXECUTE ON FUNCTION public.ops_chase_purchase_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_chase_purchase_list() TO service_role;

-- @@SPLIT@@ ============ 3. 接口E：厂家已结单少交（补单决策） ============
CREATE OR REPLACE FUNCTION public.ops_chase_closed_short_list()
RETURNS TABLE (
  sku text, style_no text, supplier_name text,
  short_qty numeric, order_count bigint, po_count int,
  oldest_pay_time timestamptz, po_details jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_ops_internal(auth.uid()) THEN
    RAISE EXCEPTION '仅限内部用户' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH base AS (
    SELECT * FROM public.ops_chase_match_core() c WHERE c.category = 'closed_short'
  ),
  per_po AS (
    SELECT b.sku AS b_sku, b.external_po_id, b.delivery_date, sum(b.match_qty) AS qty
    FROM base b
    GROUP BY b.sku, b.external_po_id, b.delivery_date
  ),
  po_json AS (
    SELECT p.b_sku, count(*)::int AS po_count,
           jsonb_agg(jsonb_build_object(
             'po_id', p.external_po_id,
             'delivery_date', (p.delivery_date AT TIME ZONE 'Asia/Shanghai')::date,
             'short_qty', p.qty) ORDER BY p.delivery_date) AS po_details
    FROM per_po p
    GROUP BY p.b_sku
  ),
  per_sku AS (
    SELECT b.sku AS b_sku, max(b.style_no) AS style_no, max(b.supplier_name) AS supplier_name,
           sum(b.match_qty) AS short_qty, count(DISTINCT b.o_id) AS order_count,
           min(b.pay_time) AS oldest_pay_time
    FROM base b
    GROUP BY b.sku
  )
  SELECT s.b_sku, s.style_no, s.supplier_name, s.short_qty, s.order_count,
         pj.po_count, s.oldest_pay_time, pj.po_details
  FROM per_sku s
  JOIN po_json pj ON pj.b_sku = s.b_sku
  ORDER BY s.short_qty DESC, s.oldest_pay_time ASC;
END
$$;

COMMENT ON FUNCTION public.ops_chase_closed_short_list() IS
  '厂家已结单少交（status=Finished 采购单的未收量按 FIFO 吃掉的需求），是永久性缺口，供补单决策使用。';

REVOKE ALL ON FUNCTION public.ops_chase_closed_short_list() FROM public;
REVOKE ALL ON FUNCTION public.ops_chase_closed_short_list() FROM anon;
GRANT EXECUTE ON FUNCTION public.ops_chase_closed_short_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_chase_closed_short_list() TO service_role;
