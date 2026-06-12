-- 催货匹配快照:页面查询从「现场算」降级为「查快照」(2026-06-13)
--
-- 背景:ops_chase_deadline_timeline 把 ops_chase_match_core(实测 ~1s/6万行,
-- 回补写入压力下更慢)现场计算了两遍(matched 去重 + urge_supplier 分支),
-- authenticated 角色 8s 语句超时下页面时间轴整条开天窗(supplier_list 单遍尚可)。
--
-- 方案(老板确认):
--   1) 新表 ops_chase_match_snapshot 持久化 match_core 全量分摊结果;
--      ops_chase_refresh_match_snapshot() 重算(advisory try-lock 防并发重算,
--      DELETE+INSERT 保持读侧 MVCC 不断档);
--   2) ops_chase_refresh_risk_meta(销售同步每页都调)末尾做节流刷新:
--      快照超过 5 分钟陈旧才重算——同步活跃期快照至多 5 分钟旧,
--      静默期由下一次 cron 兜底,前端用「数据截至 X 分钟前」角标交代;
--   3) timeline 重建:matched 去重与 urge_supplier 分支全部改读快照,
--      不再调 match_core;urgency 按 latest_ship_time 现算(消除快照档位漂移);
--      未匹配兜底分支保持现场查(单遍索引扫描,代价小);
--      新增 snapshot_at 列(每行同值)供前端角标,返回类型变更,DROP 重建。
--   7 天窗口 / 无采购单移除 / 排除表谓词与 20260612230000 保持一致。
--
-- 本文件用 -- @@SPLIT@@ 注释分块,便于 Management API 分段执行。

-- @@SPLIT@@ ============ 1. 快照表 ============
CREATE TABLE IF NOT EXISTS public.ops_chase_match_snapshot (
  sku text, style_no text, category text, match_qty numeric,
  external_po_id text, supplier_id uuid, supplier_name text,
  delivery_date timestamptz, overdue_days int, missing_delivery_date boolean,
  item_unique_key text, o_id text, pay_time timestamptz, latest_ship_time timestamptz,
  urgency text,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ops_chase_match_snapshot IS
  'ops_chase_match_core() 的持久化快照(全量替换式)。由 ops_chase_refresh_risk_meta 节流刷新(>5 分钟陈旧时),timeline 等页面查询读此表避免现场计算超时。urgency 为快照时点值,读侧应按 latest_ship_time 现算。';

ALTER TABLE public.ops_chase_match_snapshot ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.ops_chase_match_snapshot TO service_role;
-- 不给 authenticated 任何策略:页面经 SECURITY DEFINER RPC 读取

-- @@SPLIT@@ ============ 2. 快照刷新函数 ============
CREATE OR REPLACE FUNCTION public.ops_chase_refresh_match_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int;
  v_t0 timestamptz := clock_timestamp();
BEGIN
  -- 同步多页并发调用时只让一个事务重算,其余直接跳过(读侧继续用旧快照)
  IF NOT pg_try_advisory_xact_lock(hashtext('ops_chase_match_snapshot')) THEN
    RETURN jsonb_build_object('skipped', 'concurrent refresh in progress');
  END IF;
  DELETE FROM public.ops_chase_match_snapshot;
  INSERT INTO public.ops_chase_match_snapshot
    (sku, style_no, category, match_qty, external_po_id, supplier_id, supplier_name,
     delivery_date, overdue_days, missing_delivery_date, item_unique_key, o_id,
     pay_time, latest_ship_time, urgency, refreshed_at)
  SELECT c.sku, c.style_no, c.category, c.match_qty, c.external_po_id, c.supplier_id,
         c.supplier_name, c.delivery_date, c.overdue_days, c.missing_delivery_date,
         c.item_unique_key, c.o_id, c.pay_time, c.latest_ship_time, c.urgency, now()
  FROM public.ops_chase_match_core() c;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object(
    'rows', v_rows,
    'duration_ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000));
END
$$;

COMMENT ON FUNCTION public.ops_chase_refresh_match_snapshot() IS
  '全量重算催货匹配快照(advisory try-lock 防并发)。常态由 ops_chase_refresh_risk_meta 节流触发,也可手动调用强刷。';

REVOKE ALL ON FUNCTION public.ops_chase_refresh_match_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_chase_refresh_match_snapshot() FROM anon;
REVOKE ALL ON FUNCTION public.ops_chase_refresh_match_snapshot() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ops_chase_refresh_match_snapshot() TO service_role;

-- @@SPLIT@@ ============ 3. 风险行维护:末尾节流刷新快照 ============
-- 基于 20260612210000 版本,新增第 6 步;返回 jsonb 增加 match_snapshot 键。
CREATE OR REPLACE FUNCTION public.ops_chase_refresh_risk_meta(_item_keys text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sku int; v_sup_archive int; v_sup_po int; v_zombie int; v_excluded int;
  v_snap_at timestamptz; v_snap jsonb;
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

  -- 匹配快照节流刷新:超过 5 分钟陈旧才重算(~1s),页面查询只读快照
  v_snap_at := (SELECT max(s.refreshed_at) FROM public.ops_chase_match_snapshot s);
  IF v_snap_at IS NULL OR v_snap_at < now() - interval '5 minutes' THEN
    v_snap := public.ops_chase_refresh_match_snapshot();
  ELSE
    v_snap := jsonb_build_object('skipped', 'fresh', 'refreshed_at', v_snap_at);
  END IF;

  RETURN jsonb_build_object(
    'sku_backfilled', v_sku,
    'supplier_from_archive', v_sup_archive,
    'supplier_from_po', v_sup_po,
    'zombies_removed', v_zombie,
    'excluded_removed', v_excluded,
    'match_snapshot', v_snap);
END
$$;

-- @@SPLIT@@ ============ 4. 时间轴:改读快照,不再现场算 match_core ============
DROP FUNCTION IF EXISTS public.ops_chase_deadline_timeline();

CREATE FUNCTION public.ops_chase_deadline_timeline()
RETURNS TABLE (
  deadline_date date, style_no text, product_name text, image_url text,
  qty numeric, urgency text, snapshot_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_supplier uuid;
  v_snap_at timestamptz;
BEGIN
  IF public.is_ops_internal(v_uid) THEN
    v_supplier := NULL;  -- 内部用户看全部
  ELSE
    v_supplier := public.supplier_id_of(v_uid);  -- 供应商账号只看自己
    IF v_supplier IS NULL THEN
      RAISE EXCEPTION '无权访问催货时间轴' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_snap_at := (SELECT max(s.refreshed_at) FROM public.ops_chase_match_snapshot s);

  RETURN QUERY
  WITH matched AS MATERIALIZED (
    SELECT DISTINCT s.item_unique_key
    FROM public.ops_chase_match_snapshot s
    WHERE s.category IN ('urge_supplier', 'late_order', 'in_transit', 'closed_short')
      AND coalesce(s.supplier_name, '') <> ''
  ),
  agg0 AS (
    -- 可催分支:读快照;urgency 按 latest_ship_time 现算,消除快照档位漂移
    SELECT (s.latest_ship_time AT TIME ZONE 'Asia/Shanghai')::date AS d_date,
           s.style_no AS s_no,
           s.match_qty AS s_qty,
           array_position(ARRAY['overdue','due24','due48','due72','later'],
             CASE
               WHEN s.latest_ship_time <= now() THEN 'overdue'
               WHEN s.latest_ship_time <= now() + interval '24 hours' THEN 'due24'
               WHEN s.latest_ship_time <= now() + interval '48 hours' THEN 'due48'
               WHEN s.latest_ship_time <= now() + interval '72 hours' THEN 'due72'
               ELSE 'later'
             END) AS u_ord
    FROM public.ops_chase_match_snapshot s
    WHERE s.category = 'urge_supplier'
      AND (v_supplier IS NULL OR s.supplier_id = v_supplier)
      AND s.latest_ship_time IS NOT NULL
      AND s.latest_ship_time <= now() + interval '7 days'
    UNION ALL
    -- 供应商未匹配兜底(仅内部视图):保持现场查(单遍,代价小)
    SELECT (r.latest_ship_time AT TIME ZONE 'Asia/Shanghai')::date,
           coalesce(nullif(r.style_no, ''), nullif(r.sku_code, ''), '(无款号)'),
           r.qty,
           array_position(ARRAY['overdue','due24','due48','due72','later'],
             CASE
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
      AND r.latest_ship_time IS NOT NULL
      AND r.latest_ship_time <= now() + interval '7 days'
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
         (ARRAY['overdue','due24','due48','due72','later'])[a.u_ord],
         v_snap_at
  FROM agg a
  LEFT JOIN public.ops_products p ON p.code = a.s_no
  ORDER BY a.d_date ASC NULLS LAST, a.s_qty DESC, a.s_no;
END
$$;

COMMENT ON FUNCTION public.ops_chase_deadline_timeline() IS
  '催货时间轴(7 天窗口):可催分支与 matched 去重读 ops_chase_match_snapshot 快照(不再现场算 match_core),urgency 按 latest_ship_time 现算;未匹配兜底分支现场查。snapshot_at=快照时间(每行同值),供前端「数据截至」角标。供应商账号仍只见自己的 urge_supplier。';

REVOKE ALL ON FUNCTION public.ops_chase_deadline_timeline() FROM public;
REVOKE ALL ON FUNCTION public.ops_chase_deadline_timeline() FROM anon;
GRANT EXECUTE ON FUNCTION public.ops_chase_deadline_timeline() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_chase_deadline_timeline() TO service_role;

-- @@SPLIT@@ ============ 5. 首刷快照(避免新函数读空表) ============
SELECT public.ops_chase_refresh_match_snapshot();
