-- 催货清单后端：配置表 + 风险行维护 + SKU FIFO 匹配 + 聚合接口 A/B/C
--
-- 责任判定逻辑（终版，与老板确认）：以 SKU 为单位，未发货需求按订单付款时间
-- 从早到晚排队，逐件匹配采购单未到货余量（采购数量−已入库数量，按协议到货日
-- 从早到晚；缺协议到货日的排最后、按"正常在途"处理并打缺日期标记）。
--   Question 单不参与匹配，单独计数（接口C）。
--   匹配到的：a) 协议到货日 > 订单最晚发货时间 → late_order（催采购·下单过迟）
--             b) 协议到货日已过（北京日）→ urge_supplier（催供应商）
--             c) 未到 → in_transit（正常在途）
--   匹配不到 = 原始缺口 gap；最终缺口 = max(0, gap − 在途退货量×可再售率)。
--   在途退货量 = 退货类退款单已申请量(qty) − 销退入库量(qty)，按 SKU。
--   可再售率读 ops_params.chase_resale_rate（默认 0.95，不硬编码）。
--
-- 数据口径备注（生产实测）：
--   * 风险表/退货明细的商家 SKU 在 sku_id 字段，采购明细在 sku_no；
--     shipping_risk_orders.sku_code 由同步回填为商家 SKU（=light.sku_id）。
--   * 退货"已申请量"用 jst_refund_order_items.qty（r_qty 是实收，另有用途）；
--     仅统计 type 含"退货"的单（仅退款/换货/补发不产生在途退货）；排除 Cancelled。
--   * 销退入库量用 jst_aftersale_received_items.qty（其 r_qty 生产全 0）。
--   * 采购供应商映射优先商品档案 ops_products（style_no→supplier_name_snapshot），
--     档案为空时兜底取该款号最近一张采购单的 supplier_name。

-- ============ 1. 配置表 ============
CREATE TABLE IF NOT EXISTS public.ops_params (
  param_key text PRIMARY KEY,
  param_value text NOT NULL,
  description text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ops_params ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.ops_params TO authenticated;
GRANT ALL ON public.ops_params TO service_role;

DROP POLICY IF EXISTS "internal read ops_params" ON public.ops_params;
CREATE POLICY "internal read ops_params" ON public.ops_params
  FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));

DROP POLICY IF EXISTS "admin write ops_params" ON public.ops_params;
CREATE POLICY "admin write ops_params" ON public.ops_params
  FOR ALL TO authenticated
  USING (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code))
  WITH CHECK (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code));

INSERT INTO public.ops_params (param_key, param_value, description)
VALUES ('chase_resale_rate', '0.95', '催货清单：在途退货可再售率（最终缺口 = 原始缺口 − 在途退货×此比率）')
ON CONFLICT (param_key) DO NOTHING;

-- ============ 2. 风险行维护：sku_code/supplier_name 回填 + 僵尸行核销 ============
-- _item_keys 为空 = 全表维护（一次性回填）；同步每页调用时传该页 item_unique_key。
-- 僵尸核销（Split/Merged/Delivering）始终全表执行：这类行不会再被同步窗口触达。
CREATE OR REPLACE FUNCTION public.ops_chase_refresh_risk_meta(_item_keys text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sku int; v_sup_archive int; v_sup_po int; v_zombie int;
BEGIN
  UPDATE public.shipping_risk_orders r
  SET sku_code = l.sku_id
  FROM public.sales_order_light_items l
  WHERE l.item_unique_key = r.item_unique_key
    AND coalesce(r.sku_code, '') = '' AND coalesce(l.sku_id, '') <> ''
    AND (_item_keys IS NULL OR r.item_unique_key = ANY(_item_keys));
  GET DIAGNOSTICS v_sku = ROW_COUNT;

  UPDATE public.shipping_risk_orders r
  SET supplier_name = m.supplier_name
  FROM (
    SELECT DISTINCT ON (p.style_no) p.style_no,
           coalesce(p.supplier_name_snapshot, s.name) AS supplier_name
    FROM public.ops_products p
    LEFT JOIN public.ops_suppliers s ON s.id = p.supplier_id
    WHERE coalesce(p.style_no, '') <> ''
      AND coalesce(p.supplier_name_snapshot, s.name) IS NOT NULL
    ORDER BY p.style_no, p.updated_at DESC
  ) m
  WHERE r.style_no = m.style_no AND coalesce(r.supplier_name, '') = ''
    AND (_item_keys IS NULL OR r.item_unique_key = ANY(_item_keys));
  GET DIAGNOSTICS v_sup_archive = ROW_COUNT;

  UPDATE public.shipping_risk_orders r
  SET supplier_name = m.supplier_name
  FROM (
    SELECT DISTINCT ON (poi.style_no) poi.style_no, po.supplier_name
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
    WHERE coalesce(po.supplier_name, '') <> '' AND coalesce(poi.style_no, '') <> ''
      AND coalesce(po.status, '') <> 'Delete'
    ORDER BY poi.style_no, po.po_date DESC NULLS LAST
  ) m
  WHERE r.style_no = m.style_no AND coalesce(r.supplier_name, '') = ''
    AND (_item_keys IS NULL OR r.item_unique_key = ANY(_item_keys));
  GET DIAGNOSTICS v_sup_po = ROW_COUNT;

  DELETE FROM public.shipping_risk_orders r
  WHERE r.order_status IN ('Split', 'Merged', 'Delivering');
  GET DIAGNOSTICS v_zombie = ROW_COUNT;

  RETURN jsonb_build_object(
    'sku_backfilled', v_sku,
    'supplier_from_archive', v_sup_archive,
    'supplier_from_po', v_sup_po,
    'zombies_removed', v_zombie);
END
$$;

REVOKE ALL ON FUNCTION public.ops_chase_refresh_risk_meta(text[]) FROM public;
REVOKE ALL ON FUNCTION public.ops_chase_refresh_risk_meta(text[]) FROM anon;
REVOKE ALL ON FUNCTION public.ops_chase_refresh_risk_meta(text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ops_chase_refresh_risk_meta(text[]) TO service_role;

-- ============ 3. FIFO 匹配核心（内部构件，不直接暴露） ============
-- 累计区间法：需求按付款时间累计 [d_end-qty, d_end)，供给按协议到货日累计
-- [s_end-remaining, s_end)，区间重叠长度即匹配件数；超出供给总量的需求为 gap。
CREATE OR REPLACE FUNCTION public.ops_chase_match_core()
RETURNS TABLE (
  sku text, style_no text, category text, match_qty numeric,
  external_po_id text, supplier_id uuid, supplier_name text,
  delivery_date timestamptz, overdue_days int, missing_delivery_date boolean,
  item_unique_key text, o_id text, pay_time timestamptz, latest_ship_time timestamptz
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
  WHERE coalesce(r.order_status, '') NOT IN ('Question', 'Split', 'Merged', 'Delivering')
    AND coalesce(r.qty, 0) > 0
    AND coalesce(r.sku_code, '') <> ''
),
supply AS (
  SELECT poi.sku_no AS sku, po.external_po_id, po.supplier_id, po.supplier_name,
         poi.delivery_date,
         greatest(coalesce(poi.purchase_qty, 0) - coalesce(poi.received_qty, 0), 0)::numeric AS remaining,
         sum(greatest(coalesce(poi.purchase_qty, 0) - coalesce(poi.received_qty, 0), 0)::numeric) OVER (
           PARTITION BY poi.sku_no
           ORDER BY poi.delivery_date ASC NULLS LAST, poi.id
         ) AS s_end
  FROM public.purchase_order_items poi
  JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
  WHERE coalesce(po.status, '') NOT IN ('Delete', 'Cancelled')
    AND coalesce(poi.sku_no, '') <> ''
    AND coalesce(poi.purchase_qty, 0) - coalesce(poi.received_qty, 0) > 0
),
matched AS (
  SELECT d.sku, d.style_no, d.item_unique_key, d.o_id, d.pay_time, d.latest_ship_time,
         s.external_po_id, s.supplier_id, s.supplier_name, s.delivery_date,
         least(d.d_end, s.s_end) - greatest(d.d_end - d.qty, s.s_end - s.remaining) AS match_qty
  FROM demand d
  JOIN supply s ON s.sku = d.sku
  WHERE least(d.d_end, s.s_end) > greatest(d.d_end - d.qty, s.s_end - s.remaining)
)
SELECT m.sku, m.style_no,
  CASE
    WHEN m.delivery_date IS NULL THEN 'in_transit'
    WHEN m.latest_ship_time IS NOT NULL AND m.delivery_date > m.latest_ship_time THEN 'late_order'
    WHEN (m.delivery_date AT TIME ZONE 'Asia/Shanghai')::date < (now() AT TIME ZONE 'Asia/Shanghai')::date THEN 'urge_supplier'
    ELSE 'in_transit'
  END,
  m.match_qty, m.external_po_id, m.supplier_id, m.supplier_name, m.delivery_date,
  CASE WHEN m.delivery_date IS NOT NULL
       THEN greatest((now() AT TIME ZONE 'Asia/Shanghai')::date - (m.delivery_date AT TIME ZONE 'Asia/Shanghai')::date, 0)
       ELSE 0 END,
  (m.delivery_date IS NULL),
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
$$;

REVOKE ALL ON FUNCTION public.ops_chase_match_core() FROM public;
REVOKE ALL ON FUNCTION public.ops_chase_match_core() FROM anon;
REVOKE ALL ON FUNCTION public.ops_chase_match_core() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ops_chase_match_core() TO service_role;

-- ============ 4. 接口A：催供应商（供应商→SKU；将来供应商后台每家只看自己） ============
CREATE OR REPLACE FUNCTION public.ops_chase_supplier_list()
RETURNS TABLE (
  supplier_id uuid, supplier_name text, sku text, style_no text,
  overdue_qty numeric, po_count int, max_overdue_days int, po_details jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_supplier uuid;
BEGIN
  IF public.is_ops_internal(v_uid) THEN
    v_supplier := NULL;  -- 内部用户看全部
  ELSE
    v_supplier := public.supplier_id_of(v_uid);  -- 供应商账号只看自己（与采购单 RLS 同源）
    IF v_supplier IS NULL THEN
      RAISE EXCEPTION '无权访问催供应商清单' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  WITH per_po AS (
    SELECT c.supplier_id, c.supplier_name, c.sku, max(c.style_no) AS style_no,
           c.external_po_id, c.delivery_date, max(c.overdue_days) AS overdue_days,
           sum(c.match_qty) AS qty
    FROM public.ops_chase_match_core() c
    WHERE c.category = 'urge_supplier'
      AND (v_supplier IS NULL OR c.supplier_id = v_supplier)
    GROUP BY c.supplier_id, c.supplier_name, c.sku, c.external_po_id, c.delivery_date
  )
  SELECT p.supplier_id, p.supplier_name, p.sku, max(p.style_no),
         sum(p.qty), count(DISTINCT p.external_po_id)::int, max(p.overdue_days),
         jsonb_agg(jsonb_build_object(
           'po_id', p.external_po_id,
           'delivery_date', (p.delivery_date AT TIME ZONE 'Asia/Shanghai')::date,
           'overdue_days', p.overdue_days,
           'qty', p.qty) ORDER BY p.delivery_date)
  FROM per_po p
  GROUP BY p.supplier_id, p.supplier_name, p.sku
  ORDER BY max(p.overdue_days) DESC, sum(p.qty) DESC;
END
$$;

REVOKE ALL ON FUNCTION public.ops_chase_supplier_list() FROM public;
REVOKE ALL ON FUNCTION public.ops_chase_supplier_list() FROM anon;
GRANT EXECUTE ON FUNCTION public.ops_chase_supplier_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_chase_supplier_list() TO service_role;

-- ============ 5. 接口B：催采购（SKU 维度；仅 admin/采购，供应商永不可见） ============
-- 注：ops_role_code 无独立"采购"角色，按约定采购属 'ops'；admin/ops 可见。
CREATE OR REPLACE FUNCTION public.ops_chase_purchase_list()
RETURNS TABLE (
  sku text, style_no text, supplier_name text,
  pending_qty numeric, intransit_qty numeric, missing_date_qty numeric,
  late_order_qty numeric, urge_supplier_qty numeric,
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
         b.late_order_qty, b.urge_supplier_qty, b.raw_gap,
         greatest(coalesce(r.applied, 0) - coalesce(rc.received, 0), 0) AS return_in_transit,
         v_rate,
         round(greatest(coalesce(r.applied, 0) - coalesce(rc.received, 0), 0) * v_rate, 2) AS return_offset,
         greatest(b.raw_gap - greatest(coalesce(r.applied, 0) - coalesce(rc.received, 0), 0) * v_rate, 0) AS final_gap,
         b.earliest_pay_time
  FROM by_sku b
  LEFT JOIN ret r ON r.sku = b.sku
  LEFT JOIN rec rc ON rc.sku = b.sku
  ORDER BY greatest(b.raw_gap - greatest(coalesce(r.applied, 0) - coalesce(rc.received, 0), 0) * v_rate, 0) DESC,
           b.raw_gap DESC, b.earliest_pay_time ASC;
END
$$;

REVOKE ALL ON FUNCTION public.ops_chase_purchase_list() FROM public;
REVOKE ALL ON FUNCTION public.ops_chase_purchase_list() FROM anon;
GRANT EXECUTE ON FUNCTION public.ops_chase_purchase_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_chase_purchase_list() TO service_role;

-- ============ 6. 接口C：Question 单计数（客服入口） ============
CREATE OR REPLACE FUNCTION public.ops_chase_question_count()
RETURNS TABLE (question_orders bigint, question_items bigint, question_qty numeric)
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
  SELECT count(DISTINCT r.o_id), count(*), coalesce(sum(r.qty), 0)
  FROM public.shipping_risk_orders r
  WHERE r.order_status = 'Question';
END
$$;

REVOKE ALL ON FUNCTION public.ops_chase_question_count() FROM public;
REVOKE ALL ON FUNCTION public.ops_chase_question_count() FROM anon;
GRANT EXECUTE ON FUNCTION public.ops_chase_question_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_chase_question_count() TO service_role;
