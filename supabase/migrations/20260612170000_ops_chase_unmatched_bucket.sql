-- 催货清单「供应商未匹配」兜底分桶(2026-06-12)
--
-- 背景:聚水潭新链接上架到商品对应建好之间,订单挂到自动生成的副本商品
-- (style_no 为 12+ 位纯数字平台ID,supplier_name 空),在「按供应商催货」
-- 页面完全隐形直至逾期(实例:3822075322896089456 = 款 26052603 副本,
-- 6 件孤儿订单)。生产现存此类行 1.4 万+/169 款(多为无采购单且无档案
-- 供应商映射的 gap 需求)。
--
-- 变更:
--   1) 新增 ops_chase_unmatched_list():demand 同口径(Question/WaitConfirm,
--      qty>0)中 supplier_name 为空或 style_no ~ '^\d{12,}' 的行,排除
--      已匹配到带供应商采购单的行(这些回归正常供应商桶),按款聚合返回
--      SKU 明细/件数/已超时/店铺。仅内部用户可调。
--   2) ops_chase_deadline_timeline():时间轴并入上述未匹配需求
--      (按 latest_ship_time 直接归日,不经采购单匹配);供应商账号仍只看
--      自己的 urge_supplier,不下发未匹配桶。
--   3) 不改表结构;款号纠正(数字款号借同名正本款显示)沿用前端
--      ChaseListVisual 的 shortName/NUMERIC_ID 归并逻辑,本迁移通过
--      ops_products(code=款号,副本款也有档案行)带出 product_name 供归并。
--
-- 本文件用 -- @@SPLIT@@ 注释分块,便于 Management API 分段执行(请求体≤4KB)。

-- @@SPLIT@@ ============ 1. 接口G:供应商未匹配清单 ============
CREATE OR REPLACE FUNCTION public.ops_chase_unmatched_list()
RETURNS TABLE (
  style_no text, product_name text, image_url text,
  total_qty numeric, overdue_qty numeric, due24_qty numeric,
  order_count bigint, shop_names text[], earliest_ship_time timestamptz,
  sku_details jsonb
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
  WITH matched AS (
    SELECT DISTINCT c.item_unique_key
    FROM public.ops_chase_match_core() c
    WHERE c.category IN ('urge_supplier', 'late_order', 'in_transit', 'closed_short')
      AND coalesce(c.supplier_name, '') <> ''
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
  ),
  by_sku AS (
    SELECT b.s_no, b.sku, max(coalesce(b.sku_name, '')) AS sku_name,
           sum(b.qty) AS qty,
           coalesce(sum(b.qty) FILTER (WHERE b.latest_ship_time <= now()), 0) AS overdue,
           coalesce(sum(b.qty) FILTER (WHERE b.latest_ship_time > now()
             AND b.latest_ship_time <= now() + interval '24 hours'), 0) AS due24
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
         sum(k.qty), sum(k.overdue), sum(k.due24),
         st.orders, st.shops, st.earliest,
         jsonb_agg(jsonb_build_object(
           'sku', k.sku, 'sku_name', k.sku_name, 'qty', k.qty, 'overdue_qty', k.overdue
         ) ORDER BY k.overdue DESC, k.qty DESC)
  FROM by_sku k
  JOIN by_style st ON st.s_no = k.s_no
  LEFT JOIN public.ops_products p ON p.code = k.s_no
  LEFT JOIN LATERAL (
    SELECT coalesce(nullif(s.sku_image_url, ''), nullif(s.external_image_url, '')) AS img
    FROM public.ops_skus s
    WHERE s.style_no = k.s_no OR s.sku_code IN (SELECT k2.sku FROM by_sku k2 WHERE k2.s_no = k.s_no)
    ORDER BY (coalesce(nullif(s.sku_image_url, ''), nullif(s.external_image_url, '')) IS NULL)
    LIMIT 1
  ) si ON true
  GROUP BY k.s_no, p.product_name, p.name, p.code, p.main_image_url, p.external_image_url, si.img,
           st.orders, st.shops, st.earliest
  ORDER BY sum(k.overdue) DESC, sum(k.qty) DESC, k.s_no;
END
$$;

COMMENT ON FUNCTION public.ops_chase_unmatched_list() IS
  '催货兜底:供应商未匹配(supplier 空或平台数字款号)且未匹配到带供应商采购单的待发货需求,按款聚合。';

REVOKE ALL ON FUNCTION public.ops_chase_unmatched_list() FROM public;
REVOKE ALL ON FUNCTION public.ops_chase_unmatched_list() FROM anon;
GRANT EXECUTE ON FUNCTION public.ops_chase_unmatched_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_chase_unmatched_list() TO service_role;

-- @@SPLIT@@ ============ 2. 接口F:时间轴并入未匹配需求 ============
CREATE OR REPLACE FUNCTION public.ops_chase_deadline_timeline()
RETURNS TABLE (
  deadline_date date, style_no text, product_name text, image_url text,
  qty numeric, urgency text
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
    v_supplier := public.supplier_id_of(v_uid);  -- 供应商账号只看自己
    IF v_supplier IS NULL THEN
      RAISE EXCEPTION '无权访问催货时间轴' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  WITH matched AS (
    SELECT DISTINCT c.item_unique_key
    FROM public.ops_chase_match_core() c
    WHERE c.category IN ('urge_supplier', 'late_order', 'in_transit', 'closed_short')
      AND coalesce(c.supplier_name, '') <> ''
  ),
  agg0 AS (
    SELECT (c.latest_ship_time AT TIME ZONE 'Asia/Shanghai')::date AS d_date,
           c.style_no AS s_no,
           c.match_qty AS s_qty,
           array_position(ARRAY['overdue','due24','due48','due72','later'], c.urgency) AS u_ord
    FROM public.ops_chase_match_core() c
    WHERE c.category = 'urge_supplier'
      AND (v_supplier IS NULL OR c.supplier_id = v_supplier)
    UNION ALL
    -- 供应商未匹配兜底(仅内部视图):按承诺发货时间直接归日
    SELECT (r.latest_ship_time AT TIME ZONE 'Asia/Shanghai')::date,
           coalesce(nullif(r.style_no, ''), nullif(r.sku_code, ''), '(无款号)'),
           r.qty,
           array_position(ARRAY['overdue','due24','due48','due72','later'],
             CASE
               WHEN r.latest_ship_time IS NULL THEN 'later'
               WHEN r.latest_ship_time <= now() THEN 'overdue'
               WHEN r.latest_ship_time <= now() + interval '24 hours' THEN 'due24'
               WHEN r.latest_ship_time <= now() + interval '48 hours' THEN 'due48'
               WHEN r.latest_ship_time <= now() + interval '72 hours' THEN 'due72'
               ELSE 'later'
             END)
    FROM public.shipping_risk_orders r
    LEFT JOIN matched m ON m.item_unique_key = r.item_unique_key
    WHERE v_supplier IS NULL
      AND r.order_status IN ('Question', 'WaitConfirm')
      AND coalesce(r.qty, 0) > 0
      AND (coalesce(r.supplier_name, '') = '' OR coalesce(r.style_no, '') ~ '^\d{12,}')
      AND m.item_unique_key IS NULL
  ),
  agg AS (
    SELECT a.d_date, a.s_no, sum(a.s_qty) AS s_qty, min(a.u_ord) AS u_ord
    FROM agg0 a
    GROUP BY 1, 2
  )
  SELECT a.d_date, a.s_no,
         coalesce(nullif(p.product_name, ''),
                  CASE WHEN p.name <> p.code THEN p.name END),
         coalesce(nullif(p.main_image_url, ''), nullif(p.external_image_url, '')),
         a.s_qty,
         (ARRAY['overdue','due24','due48','due72','later'])[a.u_ord]
  FROM agg a
  LEFT JOIN public.ops_products p ON p.code = a.s_no
  ORDER BY a.d_date ASC NULLS LAST, a.s_qty DESC, a.s_no;
END
$$;

COMMENT ON FUNCTION public.ops_chase_deadline_timeline() IS
  '催货时间轴:urge_supplier 匹配结果 + 供应商未匹配兜底需求(仅内部),按(latest_ship_time 东八区日期 × 款号)聚合,urgency 取该组最高紧急档。供应商账号仍只见自己的 urge_supplier。';
