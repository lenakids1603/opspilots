-- 催货页「供应商未匹配」口径放宽:补登记已上线对象(2026-06-13)
--
-- 背景:ops_chase_unmatched_list() 的口径已在生产(ref cnwuimllzotitgsurofn)放宽并运行——
--   现在"有 7 天内急单且找不到供应商"的款即纳入,不再要求该款"已有采购单或条码款号"
--   (此前那条 AND 把新上、未下单、又卖不动的劝退候选款漏在外面,运营在催货页无处处理)。
--   返回结构未变(仍 13 列:style_no / product_name / image_url / *_qty / order_count /
--   shop_names / earliest_ship_time / sku_details)。生产已登记迁移名
--   ops_chase_unmatched_include_urgent_no_po,但迁移文件未入 git,若用 git 重建库会丢失,故补齐。
--   函数体由生产库 pg_get_functiondef 原样导出;本批只补 git、未在生产重新 apply。
--
-- 依赖 ops_chase_quantui_skus()(20260613060100)、ops_chase_match_snapshot、
--   ops_chase_excluded_styles 等既有对象,故排在其后;用 create or replace。
-- 授权与生产一致:REVOKE public/anon + GRANT authenticated/service_role。

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
      -- 口径：有7天内急单且找不到供应商即纳入；不再要求"已有采购单或条码款号"，
      -- 否则新上、未下单、又卖不动的款（劝退候选）会被漏在外面，运营无处处理
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
