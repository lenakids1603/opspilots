-- 催发货风险表全量刷新:明细来源切换为 sales_order_light_items 为主,
-- 旧表 jst_sales_order_items 仅覆盖 2026-06-04 及之前下单、且新表无行的订单。
--
-- 背景(2026-06-12):6/7 销售同步切换轻量架构后,风险表只靠同步窗口增量维护;
-- 2026-06-04 及之前最后修改、之后未再变动的未发货订单(以 Question 单为主,
-- 生产约 2.25 万单)不再被同步窗口触达,且明细只存在于旧表,从未进入风险表,
-- 导致发货截止时间轴大面积缺单(生产未发货 50,069 单 vs 风险表 26,827 单)。
--
-- 口径(与同步函数 syncShippingRisks 保持一致):
--   * 候选 = internal_order_type = 'paid_pending_ship'
--     且 status NOT IN (Sent/Cancelled/Split/Merged/Delivering);
--     Split/Merged/Delivering 即同步侧 RISK_SETTLED_STATUSES(已核销,
--     ops_chase_refresh_risk_meta 的僵尸清理也会删它们)。
--   * 明细新表优先:旧表仅补充「北京时间 2026-06-04 及之前下单且新表完全无行」
--     的订单(按订单粒度去重,新表优先,二源不会同时贡献同一订单)。
--   * item_unique_key 两表构造同源(o_id|item_id|sku_id|index),upsert 幂等。
--   * 发货截止 = plan_delivery_date,缺省 pay_time+48h,再缺省下单时间+48h。
--   * 不在本次结果集中的存量行一律删除(全量重建语义,重复执行行数稳定)。

CREATE OR REPLACE FUNCTION public.ops_refresh_shipping_risk_full()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_candidates int;
  v_rows int;
  v_upserted int;
  v_stale_deleted int;
  v_no_detail int;
  v_no_detail_sample jsonb;
  v_meta jsonb;
BEGIN
  DROP TABLE IF EXISTS tmp_srf_orders;
  DROP TABLE IF EXISTS tmp_srf_rows;

  CREATE TEMP TABLE tmp_srf_orders ON COMMIT DROP AS
  SELECT o.id, o.jst_o_id, o.so_id, o.shop_id, o.shop_name, o.status,
         coalesce(o.order_created_at, o.created_time) AS order_created_at,
         o.pay_time, o.modified_time, o.plan_delivery_date
  FROM public.jst_sales_orders o
  WHERE o.internal_order_type = 'paid_pending_ship'
    AND coalesce(o.status, '') NOT IN ('Sent', 'Cancelled', 'Split', 'Merged', 'Delivering');
  SELECT count(*) INTO v_candidates FROM tmp_srf_orders;
  CREATE INDEX ON tmp_srf_orders (jst_o_id);

  CREATE TEMP TABLE tmp_srf_rows ON COMMIT DROP AS
  SELECT DISTINCT ON (item_unique_key) *
  FROM (
    SELECT
      l.item_unique_key, 0 AS src,
      c.jst_o_id AS o_id, c.so_id, c.shop_id, c.shop_name, l.platform,
      c.status AS order_status, c.order_created_at, c.pay_time,
      c.modified_time AS jst_modified, c.plan_delivery_date,
      coalesce(nullif(l.sku_id, ''), l.sku_code) AS sku_code,
      l.sku_name, l.style_no, l.color, l.size,
      coalesce(l.qty, 0) AS qty, l.supplier_name
    FROM tmp_srf_orders c
    JOIN public.sales_order_light_items l ON l.o_id = c.jst_o_id
    UNION ALL
    SELECT
      coalesce(nullif(i.item_unique_key, ''),
               concat_ws('|', c.jst_o_id, coalesce(i.jst_item_id, ''), coalesce(i.sku_id, ''), coalesce(i.item_index::text, ''))),
      1,
      c.jst_o_id, c.so_id, c.shop_id, c.shop_name, NULL,
      c.status, c.order_created_at, c.pay_time, c.modified_time, c.plan_delivery_date,
      coalesce(nullif(i.sku_id, ''), i.sku_code),
      i.sku_name,
      coalesce(nullif(i.i_id, ''), nullif(i.sku_code, '')),
      NULL, NULL, coalesce(i.qty, 0), i.supplier_name
    FROM tmp_srf_orders c
    JOIN public.jst_sales_order_items i ON i.sales_order_id = c.id
    WHERE (coalesce(c.order_created_at, c.pay_time) AT TIME ZONE 'Asia/Shanghai')::date <= DATE '2026-06-04'
      AND NOT EXISTS (SELECT 1 FROM public.sales_order_light_items l2 WHERE l2.o_id = c.jst_o_id)
  ) u
  ORDER BY item_unique_key, src;
  SELECT count(*) INTO v_rows FROM tmp_srf_rows;
  CREATE INDEX ON tmp_srf_rows (item_unique_key);
  CREATE INDEX ON tmp_srf_rows (o_id);

  -- 与 15 分钟销售同步的风险表 upsert 并发会死锁(staging 实测 40P01);
  -- EXCLUSIVE 锁阻塞并发写、不阻塞读,令全量重建与增量同步串行。
  LOCK TABLE public.shipping_risk_orders IN EXCLUSIVE MODE;

  INSERT INTO public.shipping_risk_orders (
    item_unique_key, o_id, so_id, shop_id, shop_name, platform, order_status,
    order_created_at, pay_time, jst_modified, latest_ship_time, remaining_hours,
    is_timeout, risk_level, sku_code, sku_name, style_no, color, size, qty,
    supplier_name, last_checked_at
  )
  SELECT
    s.item_unique_key, s.o_id, s.so_id, s.shop_id, s.shop_name, s.platform, s.order_status,
    s.order_created_at, s.pay_time, s.jst_modified,
    s.deadline,
    CASE WHEN s.deadline IS NULL THEN NULL
         ELSE EXTRACT(epoch FROM (s.deadline - now())) / 3600 END,
    s.deadline IS NOT NULL AND s.deadline < now(),
    CASE
      WHEN s.deadline IS NULL THEN 'unknown'
      WHEN s.deadline < now() THEN 'timeout'
      WHEN s.deadline <= now() + interval '6 hours' THEN 'high'
      WHEN s.deadline <= now() + interval '24 hours' THEN 'medium'
      ELSE 'low'
    END,
    s.sku_code, s.sku_name, s.style_no, s.color, s.size, s.qty, s.supplier_name, now()
  FROM (
    SELECT t.*,
           coalesce(t.plan_delivery_date, t.pay_time + interval '48 hours', t.order_created_at + interval '48 hours') AS deadline
    FROM tmp_srf_rows t
  ) s
  ON CONFLICT (item_unique_key) DO UPDATE SET
    o_id = EXCLUDED.o_id,
    so_id = EXCLUDED.so_id,
    shop_id = EXCLUDED.shop_id,
    shop_name = EXCLUDED.shop_name,
    platform = coalesce(EXCLUDED.platform, shipping_risk_orders.platform),
    order_status = EXCLUDED.order_status,
    order_created_at = coalesce(EXCLUDED.order_created_at, shipping_risk_orders.order_created_at),
    pay_time = EXCLUDED.pay_time,
    jst_modified = EXCLUDED.jst_modified,
    latest_ship_time = EXCLUDED.latest_ship_time,
    remaining_hours = EXCLUDED.remaining_hours,
    is_timeout = EXCLUDED.is_timeout,
    risk_level = EXCLUDED.risk_level,
    sku_code = coalesce(nullif(EXCLUDED.sku_code, ''), shipping_risk_orders.sku_code),
    sku_name = coalesce(EXCLUDED.sku_name, shipping_risk_orders.sku_name),
    style_no = coalesce(nullif(EXCLUDED.style_no, ''), shipping_risk_orders.style_no),
    color = coalesce(EXCLUDED.color, shipping_risk_orders.color),
    size = coalesce(EXCLUDED.size, shipping_risk_orders.size),
    qty = EXCLUDED.qty,
    supplier_name = coalesce(nullif(EXCLUDED.supplier_name, ''), shipping_risk_orders.supplier_name),
    last_checked_at = now(),
    updated_at = now();
  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  DELETE FROM public.shipping_risk_orders r
  WHERE NOT EXISTS (SELECT 1 FROM tmp_srf_rows t WHERE t.item_unique_key = r.item_unique_key);
  GET DIAGNOSTICS v_stale_deleted = ROW_COUNT;

  SELECT count(*) INTO v_no_detail
  FROM tmp_srf_orders c
  WHERE NOT EXISTS (SELECT 1 FROM tmp_srf_rows t WHERE t.o_id = c.jst_o_id);
  SELECT coalesce(jsonb_agg(to_jsonb(smp)), '[]'::jsonb) INTO v_no_detail_sample
  FROM (
    SELECT c.jst_o_id, c.status, c.order_created_at
    FROM tmp_srf_orders c
    WHERE NOT EXISTS (SELECT 1 FROM tmp_srf_rows t WHERE t.o_id = c.jst_o_id)
    ORDER BY c.order_created_at DESC NULLS LAST
    LIMIT 20
  ) smp;

  -- 供应商/sku_code 元数据回填 + 僵尸清理(与同步侧同一函数,保证口径一致)
  v_meta := public.ops_chase_refresh_risk_meta(NULL);

  RETURN jsonb_build_object(
    'candidate_orders', v_candidates,
    'detail_rows', v_rows,
    'rows_upserted', v_upserted,
    'stale_rows_deleted', v_stale_deleted,
    'orders_without_detail', v_no_detail,
    'orders_without_detail_sample', v_no_detail_sample,
    'meta', v_meta);
END
$fn$;

REVOKE ALL ON FUNCTION public.ops_refresh_shipping_risk_full() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_refresh_shipping_risk_full() FROM anon;
REVOKE ALL ON FUNCTION public.ops_refresh_shipping_risk_full() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ops_refresh_shipping_risk_full() TO service_role;
