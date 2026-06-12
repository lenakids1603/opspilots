-- 催货体系 SKU/款号排除表(2026-06-12,老板确认口径)
--
-- 背景:
--   * style_no='sc'(sku_code='SC',「默认:默认」):抖店合规用赠品编码,配饰缝于
--     衣身随衣发货,无独立采购与发货 —— 不应出现在任何催货/发货超时视图
--     (生产现存 5,374 行/5,396 件,曾占「供应商未匹配」桶近半件数)。
--   * style_no='0000' / sku='0000':顾客配件补发专用链接,无需催供应商,
--     但属真实发货,需保留在发货超时预警中监控时效。
--
-- 设计:
--   * 配置表 ops_chase_excluded_styles:style_no(大小写不敏感精确匹配)、
--     sku(精确匹配)、scope('chase'|'all')。一行内 style_no/sku 同时给出时为
--     AND 语义;OR 用多行表达。至少填一个键。
--   * scope='chase':仅从催货页 RPC(match_core 需求侧→供应商/采购/紧急度/
--     已结单少交全部继承;question_count;unmatched_list;deadline_timeline
--     兜底分支)排除;风险表保留 → 发货超时预警(直读表的前端)仍可见。
--   * scope='all':上述之外,还从 shipping_risk_orders 本体排除 —— 全量刷新
--     不再写入(存量被 stale 清理删除),ops_chase_refresh_risk_meta 增加常态
--     删除(销售同步每页调用,新插入的行 15 分钟内被清掉),发货超时预警随之不可见。
--   * 谓词一律内联 NOT EXISTS(集合化反连接);不抽函数,避免每行 SPI 调用
--     拖慢 64k+ 行扫描(match_core 单次页面渲染会被调用 6+ 次)。
--
-- 本文件用 -- @@SPLIT@@ 注释分块,便于 Management API 分段执行。

-- @@SPLIT@@ ============ 1. 配置表 + RLS + 种子 ============
CREATE TABLE IF NOT EXISTS public.ops_chase_excluded_styles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  style_no text,
  sku text,
  scope text NOT NULL DEFAULT 'chase',
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_chase_excluded_scope_chk CHECK (scope IN ('chase', 'all')),
  CONSTRAINT ops_chase_excluded_key_chk CHECK (style_no IS NOT NULL OR sku IS NOT NULL)
);

COMMENT ON TABLE public.ops_chase_excluded_styles IS
  '催货排除表:style_no 大小写不敏感精确匹配,sku 精确匹配;同行两键=AND,多行=OR。scope=chase 仅催货页排除;scope=all 连发货超时预警(shipping_risk_orders 本体)一并排除。';

CREATE UNIQUE INDEX IF NOT EXISTS ops_chase_excluded_styles_key_idx
  ON public.ops_chase_excluded_styles (coalesce(lower(style_no), ''), coalesce(sku, ''));

ALTER TABLE public.ops_chase_excluded_styles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.ops_chase_excluded_styles TO authenticated;
GRANT ALL ON public.ops_chase_excluded_styles TO service_role;

DROP POLICY IF EXISTS "select ops_chase_excluded_styles" ON public.ops_chase_excluded_styles;
CREATE POLICY "select ops_chase_excluded_styles" ON public.ops_chase_excluded_styles
  FOR SELECT TO authenticated USING (public.is_ops_internal((select auth.uid())));

DROP POLICY IF EXISTS "insert ops_chase_excluded_styles" ON public.ops_chase_excluded_styles;
CREATE POLICY "insert ops_chase_excluded_styles" ON public.ops_chase_excluded_styles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_ops_role((select auth.uid()), 'admin'::public.ops_role_code));

DROP POLICY IF EXISTS "update ops_chase_excluded_styles" ON public.ops_chase_excluded_styles;
CREATE POLICY "update ops_chase_excluded_styles" ON public.ops_chase_excluded_styles
  FOR UPDATE TO authenticated
  USING (public.has_ops_role((select auth.uid()), 'admin'::public.ops_role_code))
  WITH CHECK (public.has_ops_role((select auth.uid()), 'admin'::public.ops_role_code));

DROP POLICY IF EXISTS "delete ops_chase_excluded_styles" ON public.ops_chase_excluded_styles;
CREATE POLICY "delete ops_chase_excluded_styles" ON public.ops_chase_excluded_styles
  FOR DELETE TO authenticated
  USING (public.has_ops_role((select auth.uid()), 'admin'::public.ops_role_code));

INSERT INTO public.ops_chase_excluded_styles (style_no, sku, scope, remark) VALUES
  ('sc', NULL, 'all', '抖店合规用赠品编码:配饰缝于衣身随衣发货,无独立采购与发货'),
  ('0000', NULL, 'chase', '顾客配件补发专用链接:无需催供应商;属真实发货,保留在发货超时预警中监控时效'),
  (NULL, '0000', 'chase', '顾客配件补发专用链接:无需催供应商;属真实发货,保留在发货超时预警中监控时效')
ON CONFLICT DO NOTHING;

-- @@SPLIT@@ ============ 2. 风险行维护:增加 scope=all 常态删除 ============
-- 基于 20260611060000 版本;新增 excluded_removed(销售同步每页调用,保证
-- 同步侧新插入的排除行持续被清掉,无需改 jst-sync-sales-orders 函数)。
CREATE OR REPLACE FUNCTION public.ops_chase_refresh_risk_meta(_item_keys text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sku int; v_sup_archive int; v_sup_po int; v_zombie int; v_excluded int;
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

  -- scope=all 排除行常态清理(始终全表,与僵尸核销同策略)
  DELETE FROM public.shipping_risk_orders r
  USING public.ops_chase_excluded_styles e
  WHERE e.scope = 'all'
    AND (e.style_no IS NULL OR lower(e.style_no) = lower(coalesce(r.style_no, '')))
    AND (e.sku IS NULL OR e.sku = coalesce(r.sku_code, ''));
  GET DIAGNOSTICS v_excluded = ROW_COUNT;

  RETURN jsonb_build_object(
    'sku_backfilled', v_sku,
    'supplier_from_archive', v_sup_archive,
    'supplier_from_po', v_sup_po,
    'zombies_removed', v_zombie,
    'excluded_removed', v_excluded);
END
$$;

-- @@SPLIT@@ ============ 3. FIFO 匹配核心:需求侧应用排除表(chase 口径) ============
-- 基于 20260611200000 版本,demand 增加 NOT EXISTS 排除(chase+all 两种 scope)。
-- 供应商/催采购/紧急度汇总/已结单少交均经此函数取数,自动继承。
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
    AND NOT EXISTS (
      SELECT 1 FROM public.ops_chase_excluded_styles e
      WHERE e.scope IN ('chase', 'all')
        AND (e.style_no IS NULL OR lower(e.style_no) = lower(coalesce(r.style_no, '')))
        AND (e.sku IS NULL OR e.sku = coalesce(r.sku_code, ''))
    )
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

-- @@SPLIT@@ ============ 4. 待审核计数:应用排除表(chase 口径) ============
-- 基于 20260611150000 版本。
CREATE OR REPLACE FUNCTION public.ops_chase_question_count()
RETURNS TABLE (pending_review_orders bigint, pending_review_items bigint, pending_review_qty numeric)
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
  WHERE r.order_status = 'Question'
    AND NOT EXISTS (
      SELECT 1 FROM public.ops_chase_excluded_styles e
      WHERE e.scope IN ('chase', 'all')
        AND (e.style_no IS NULL OR lower(e.style_no) = lower(coalesce(r.style_no, '')))
        AND (e.sku IS NULL OR e.sku = coalesce(r.sku_code, ''))
    );
END
$$;

-- @@SPLIT@@ ============ 5. 供应商未匹配清单:应用排除表(chase 口径) ============
-- 基于 20260612170000 版本,base 增加 NOT EXISTS 排除。
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

-- @@SPLIT@@ ============ 6. 发货截止时间轴:兜底分支应用排除表(chase 口径) ============
-- 基于 20260612170000 版本;urge_supplier 分支经 match_core 已继承,仅改兜底分支。
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
      AND NOT EXISTS (
        SELECT 1 FROM public.ops_chase_excluded_styles e
        WHERE e.scope IN ('chase', 'all')
          AND (e.style_no IS NULL OR lower(e.style_no) = lower(coalesce(r.style_no, '')))
          AND (e.sku IS NULL OR e.sku = coalesce(r.sku_code, ''))
      )
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

-- @@SPLIT@@ ============ 7. 风险表全量刷新:scope=all 不写入(存量随 stale 清理删除) ============
-- 基于 20260612110000 版本,tmp_srf_rows 外层增加排除(仅 scope=all;
-- scope=chase 的行保留在风险表,发货超时预警继续监控)。
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
  WHERE NOT EXISTS (
    SELECT 1 FROM public.ops_chase_excluded_styles e
    WHERE e.scope = 'all'
      AND (e.style_no IS NULL OR lower(e.style_no) = lower(coalesce(u.style_no, '')))
      AND (e.sku IS NULL OR e.sku = coalesce(u.sku_code, ''))
  )
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

  -- 供应商/sku_code 元数据回填 + 僵尸清理 + 排除行清理(与同步侧同一函数,保证口径一致)
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
