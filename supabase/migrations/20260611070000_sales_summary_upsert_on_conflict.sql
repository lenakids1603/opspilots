-- refresh_sales_summaries_for_order_items：并发安全化。
-- 背景：2026-06-11 生产销售同步任务因 "duplicate key value violates unique constraint
-- sales_hourly_summary_key_idx" 与 lock timeout 失败。20260611050200 的实现为
-- DELETE + INSERT，两个并发调用（销售同步 tick 之间、或与手动任务重叠）会在
-- DELETE 之后同时 INSERT 相同 summary_key 触发唯一键冲突，DELETE 行锁互等则触发
-- lock timeout（authenticator 会话 lock_timeout=8s）。
-- 修复：
--   1. 函数入口 pg_advisory_xact_lock 串行化（050200 改为按日期过滤后单次调用已很快，
--      串行化代价小）；函数级 lock_timeout 放宽到 20s 容忍排队。
--   2. 四张汇总表 INSERT 全部改为 ON CONFLICT (summary_key) DO UPDATE 兜底，
--      即使锁外仍有写入者也不再报唯一键冲突。
--   3. 保留 DELETE：清掉重算后不复存在的桶（如订单改店铺/SKU 后旧维度组合）。
-- 表达式索引与 050200 相同，IF NOT EXISTS 以便新环境直接重放本文件。

CREATE INDEX IF NOT EXISTS idx_sales_light_items_business_date
  ON public.sales_order_light_items
  (((coalesce(order_created_at, pay_time) AT TIME ZONE 'Asia/Shanghai')::date));

CREATE OR REPLACE FUNCTION public.refresh_sales_summaries_for_order_items(_item_keys text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '20s'
AS $$
DECLARE
  hourly_rows int := 0;
  daily_rows int := 0;
  sku_rows int := 0;
  style_rows int := 0;
BEGIN
  IF _item_keys IS NULL OR cardinality(_item_keys) = 0 THEN
    RETURN jsonb_build_object('hourly', 0, 'daily', 0, 'sku_daily', 0, 'style_daily', 0);
  END IF;

  -- 串行化并发重算：销售同步每页调用一次，多个 tick / 手动+定时任务可能重叠
  PERFORM pg_advisory_xact_lock(hashtext('refresh_sales_summaries_for_order_items'));

  CREATE TEMP TABLE tmp_sales_refresh_keys ON COMMIT DROP AS
  SELECT DISTINCT item_unique_key
  FROM unnest(_item_keys) AS k(item_unique_key)
  WHERE item_unique_key IS NOT NULL AND btrim(item_unique_key) <> '';

  CREATE TEMP TABLE tmp_sales_refresh_facts ON COMMIT DROP AS
  SELECT
    f.*,
    coalesce(f.order_created_at, f.pay_time) AS business_time
  FROM public.sales_order_light_items f
  WHERE f.item_unique_key IN (SELECT item_unique_key FROM tmp_sales_refresh_keys)
    AND coalesce(f.order_created_at, f.pay_time) IS NOT NULL;

  CREATE TEMP TABLE tmp_sales_refresh_dates ON COMMIT DROP AS
  SELECT DISTINCT (refresh_time AT TIME ZONE 'Asia/Shanghai')::date AS summary_date
  FROM tmp_sales_refresh_facts
  CROSS JOIN LATERAL (VALUES (business_time), (pay_time)) AS t(refresh_time)
  WHERE refresh_time IS NOT NULL;

  CREATE TEMP TABLE tmp_sales_refresh_all_facts ON COMMIT DROP AS
  SELECT
    f.*,
    coalesce(f.order_created_at, f.pay_time) AS business_time
  FROM public.sales_order_light_items f
  WHERE coalesce(f.order_created_at, f.pay_time) IS NOT NULL
    AND (coalesce(f.order_created_at, f.pay_time) AT TIME ZONE 'Asia/Shanghai')::date
        IN (SELECT summary_date FROM tmp_sales_refresh_dates);

  CREATE TEMP TABLE tmp_hourly_dims ON COMMIT DROP AS
  SELECT DISTINCT
    (refresh_time AT TIME ZONE 'Asia/Shanghai')::date AS summary_date,
    EXTRACT(hour FROM refresh_time AT TIME ZONE 'Asia/Shanghai')::int AS summary_hour,
    platform, shop_id, sku_code, style_no
  FROM tmp_sales_refresh_facts
  CROSS JOIN LATERAL (VALUES (business_time), (pay_time)) AS t(refresh_time)
  WHERE refresh_time IS NOT NULL;

  CREATE TEMP TABLE tmp_daily_dims ON COMMIT DROP AS
  SELECT DISTINCT
    (refresh_time AT TIME ZONE 'Asia/Shanghai')::date AS summary_date,
    platform, shop_id
  FROM tmp_sales_refresh_facts
  CROSS JOIN LATERAL (VALUES (business_time), (pay_time)) AS t(refresh_time)
  WHERE refresh_time IS NOT NULL;

  CREATE TEMP TABLE tmp_sku_dims ON COMMIT DROP AS
  SELECT DISTINCT
    (refresh_time AT TIME ZONE 'Asia/Shanghai')::date AS summary_date,
    platform, shop_id, sku_code
  FROM tmp_sales_refresh_facts
  CROSS JOIN LATERAL (VALUES (business_time), (pay_time)) AS t(refresh_time)
  WHERE refresh_time IS NOT NULL;

  CREATE TEMP TABLE tmp_style_dims ON COMMIT DROP AS
  SELECT DISTINCT
    (refresh_time AT TIME ZONE 'Asia/Shanghai')::date AS summary_date,
    platform, shop_id, style_no
  FROM tmp_sales_refresh_facts
  CROSS JOIN LATERAL (VALUES (business_time), (pay_time)) AS t(refresh_time)
  WHERE refresh_time IS NOT NULL;

  DELETE FROM public.sales_hourly_summary h
  USING tmp_hourly_dims d
  WHERE h.summary_key = md5(concat_ws('|', d.summary_date::text, d.summary_hour::text, coalesce(d.platform, ''), coalesce(d.shop_id, ''), coalesce(d.sku_code, ''), coalesce(d.style_no, '')));

  INSERT INTO public.sales_hourly_summary (
    summary_date, summary_hour, platform, shop_id, shop_name, style_no, sku_code, supplier_name,
    pay_order_count, pay_item_count, pay_qty, pay_amount,
    net_qty, net_amount, estimated_cost_amount, estimated_gross_profit,
    first_order_time, last_order_time, last_jst_modified, summary_key, updated_at
  )
  SELECT
    (f.business_time AT TIME ZONE 'Asia/Shanghai')::date,
    EXTRACT(hour FROM f.business_time AT TIME ZONE 'Asia/Shanghai')::int,
    f.platform, f.shop_id, max(f.shop_name), f.style_no, f.sku_code, max(f.supplier_name),
    count(DISTINCT f.o_id)::int,
    count(*)::int,
    coalesce(sum(f.qty), 0),
    coalesce(sum(f.pay_amount), 0),
    coalesce(sum(f.qty), 0),
    coalesce(sum(f.pay_amount), 0),
    coalesce(sum(f.estimated_cost_amount), 0),
    coalesce(sum(f.pay_amount), 0) - coalesce(sum(f.estimated_cost_amount), 0),
    min(f.business_time),
    max(f.business_time),
    max(f.last_jst_modified),
    md5(concat_ws('|', ((f.business_time AT TIME ZONE 'Asia/Shanghai')::date)::text, (EXTRACT(hour FROM f.business_time AT TIME ZONE 'Asia/Shanghai')::int)::text, coalesce(f.platform, ''), coalesce(f.shop_id, ''), coalesce(f.sku_code, ''), coalesce(f.style_no, ''))),
    now()
  FROM tmp_sales_refresh_all_facts f
  JOIN tmp_hourly_dims d
    ON d.summary_date = (f.business_time AT TIME ZONE 'Asia/Shanghai')::date
   AND d.summary_hour = EXTRACT(hour FROM f.business_time AT TIME ZONE 'Asia/Shanghai')::int
   AND coalesce(d.platform, '') = coalesce(f.platform, '')
   AND coalesce(d.shop_id, '') = coalesce(f.shop_id, '')
   AND coalesce(d.sku_code, '') = coalesce(f.sku_code, '')
   AND coalesce(d.style_no, '') = coalesce(f.style_no, '')
  GROUP BY 1, 2, 3, 4, 6, 7
  ON CONFLICT (summary_key) DO UPDATE SET
    shop_name = excluded.shop_name,
    supplier_name = excluded.supplier_name,
    pay_order_count = excluded.pay_order_count,
    pay_item_count = excluded.pay_item_count,
    pay_qty = excluded.pay_qty,
    pay_amount = excluded.pay_amount,
    net_qty = excluded.net_qty,
    net_amount = excluded.net_amount,
    estimated_cost_amount = excluded.estimated_cost_amount,
    estimated_gross_profit = excluded.estimated_gross_profit,
    first_order_time = excluded.first_order_time,
    last_order_time = excluded.last_order_time,
    last_jst_modified = excluded.last_jst_modified,
    updated_at = excluded.updated_at;
  GET DIAGNOSTICS hourly_rows = ROW_COUNT;

  DELETE FROM public.sales_daily_summary s
  USING tmp_daily_dims d
  WHERE s.summary_key = md5(concat_ws('|', d.summary_date::text, coalesce(d.platform, ''), coalesce(d.shop_id, '')));

  INSERT INTO public.sales_daily_summary (
    summary_date, platform, shop_id, shop_name,
    pay_order_count, pay_item_count, pay_qty, pay_amount,
    net_qty, net_amount, estimated_cost_amount, estimated_gross_profit,
    first_order_time, last_order_time, last_jst_modified, summary_key, updated_at
  )
  SELECT
    (f.business_time AT TIME ZONE 'Asia/Shanghai')::date,
    f.platform, f.shop_id, max(f.shop_name),
    count(DISTINCT f.o_id)::int,
    count(*)::int,
    coalesce(sum(f.qty), 0),
    coalesce(sum(f.pay_amount), 0),
    coalesce(sum(f.qty), 0),
    coalesce(sum(f.pay_amount), 0),
    coalesce(sum(f.estimated_cost_amount), 0),
    coalesce(sum(f.pay_amount), 0) - coalesce(sum(f.estimated_cost_amount), 0),
    min(f.business_time),
    max(f.business_time),
    max(f.last_jst_modified),
    md5(concat_ws('|', ((f.business_time AT TIME ZONE 'Asia/Shanghai')::date)::text, coalesce(f.platform, ''), coalesce(f.shop_id, ''))),
    now()
  FROM tmp_sales_refresh_all_facts f
  JOIN tmp_daily_dims d
    ON d.summary_date = (f.business_time AT TIME ZONE 'Asia/Shanghai')::date
   AND coalesce(d.platform, '') = coalesce(f.platform, '')
   AND coalesce(d.shop_id, '') = coalesce(f.shop_id, '')
  GROUP BY 1, 2, 3
  ON CONFLICT (summary_key) DO UPDATE SET
    shop_name = excluded.shop_name,
    pay_order_count = excluded.pay_order_count,
    pay_item_count = excluded.pay_item_count,
    pay_qty = excluded.pay_qty,
    pay_amount = excluded.pay_amount,
    net_qty = excluded.net_qty,
    net_amount = excluded.net_amount,
    estimated_cost_amount = excluded.estimated_cost_amount,
    estimated_gross_profit = excluded.estimated_gross_profit,
    first_order_time = excluded.first_order_time,
    last_order_time = excluded.last_order_time,
    last_jst_modified = excluded.last_jst_modified,
    updated_at = excluded.updated_at;
  GET DIAGNOSTICS daily_rows = ROW_COUNT;

  DELETE FROM public.sales_sku_daily_summary s
  USING tmp_sku_dims d
  WHERE s.summary_key = md5(concat_ws('|', d.summary_date::text, coalesce(d.platform, ''), coalesce(d.shop_id, ''), coalesce(d.sku_code, '')));

  INSERT INTO public.sales_sku_daily_summary (
    summary_date, platform, shop_id, shop_name, sku_code, sku_name, style_no, color, size, supplier_name,
    pay_order_count, pay_qty, pay_amount, net_qty, net_amount,
    estimated_cost_price, estimated_cost_amount, estimated_gross_profit, last_jst_modified, summary_key, updated_at
  )
  SELECT
    (f.business_time AT TIME ZONE 'Asia/Shanghai')::date,
    f.platform, f.shop_id, max(f.shop_name), f.sku_code, max(f.sku_name), max(f.style_no), max(f.color), max(f.size), max(f.supplier_name),
    count(DISTINCT f.o_id)::int,
    coalesce(sum(f.qty), 0),
    coalesce(sum(f.pay_amount), 0),
    coalesce(sum(f.qty), 0),
    coalesce(sum(f.pay_amount), 0),
    max(f.estimated_cost_price),
    coalesce(sum(f.estimated_cost_amount), 0),
    coalesce(sum(f.pay_amount), 0) - coalesce(sum(f.estimated_cost_amount), 0),
    max(f.last_jst_modified),
    md5(concat_ws('|', ((f.business_time AT TIME ZONE 'Asia/Shanghai')::date)::text, coalesce(f.platform, ''), coalesce(f.shop_id, ''), coalesce(f.sku_code, ''))),
    now()
  FROM tmp_sales_refresh_all_facts f
  JOIN tmp_sku_dims d
    ON d.summary_date = (f.business_time AT TIME ZONE 'Asia/Shanghai')::date
   AND coalesce(d.platform, '') = coalesce(f.platform, '')
   AND coalesce(d.shop_id, '') = coalesce(f.shop_id, '')
   AND coalesce(d.sku_code, '') = coalesce(f.sku_code, '')
  GROUP BY 1, 2, 3, 5
  ON CONFLICT (summary_key) DO UPDATE SET
    shop_name = excluded.shop_name,
    sku_name = excluded.sku_name,
    style_no = excluded.style_no,
    color = excluded.color,
    size = excluded.size,
    supplier_name = excluded.supplier_name,
    pay_order_count = excluded.pay_order_count,
    pay_qty = excluded.pay_qty,
    pay_amount = excluded.pay_amount,
    net_qty = excluded.net_qty,
    net_amount = excluded.net_amount,
    estimated_cost_price = excluded.estimated_cost_price,
    estimated_cost_amount = excluded.estimated_cost_amount,
    estimated_gross_profit = excluded.estimated_gross_profit,
    last_jst_modified = excluded.last_jst_modified,
    updated_at = excluded.updated_at;
  GET DIAGNOSTICS sku_rows = ROW_COUNT;

  DELETE FROM public.sales_style_daily_summary s
  USING tmp_style_dims d
  WHERE s.summary_key = md5(concat_ws('|', d.summary_date::text, coalesce(d.platform, ''), coalesce(d.shop_id, ''), coalesce(d.style_no, '')));

  INSERT INTO public.sales_style_daily_summary (
    summary_date, platform, shop_id, shop_name, style_no, supplier_name,
    pay_order_count, pay_sku_count, pay_qty, pay_amount,
    net_qty, net_amount, estimated_cost_amount, estimated_gross_profit, last_jst_modified, summary_key, updated_at
  )
  SELECT
    (f.business_time AT TIME ZONE 'Asia/Shanghai')::date,
    f.platform, f.shop_id, max(f.shop_name), f.style_no, max(f.supplier_name),
    count(DISTINCT f.o_id)::int,
    count(DISTINCT f.sku_code)::int,
    coalesce(sum(f.qty), 0),
    coalesce(sum(f.pay_amount), 0),
    coalesce(sum(f.qty), 0),
    coalesce(sum(f.pay_amount), 0),
    coalesce(sum(f.estimated_cost_amount), 0),
    coalesce(sum(f.pay_amount), 0) - coalesce(sum(f.estimated_cost_amount), 0),
    max(f.last_jst_modified),
    md5(concat_ws('|', ((f.business_time AT TIME ZONE 'Asia/Shanghai')::date)::text, coalesce(f.platform, ''), coalesce(f.shop_id, ''), coalesce(f.style_no, ''))),
    now()
  FROM tmp_sales_refresh_all_facts f
  JOIN tmp_style_dims d
    ON d.summary_date = (f.business_time AT TIME ZONE 'Asia/Shanghai')::date
   AND coalesce(d.platform, '') = coalesce(f.platform, '')
   AND coalesce(d.shop_id, '') = coalesce(f.shop_id, '')
   AND coalesce(d.style_no, '') = coalesce(f.style_no, '')
  GROUP BY 1, 2, 3, 5
  ON CONFLICT (summary_key) DO UPDATE SET
    shop_name = excluded.shop_name,
    supplier_name = excluded.supplier_name,
    pay_order_count = excluded.pay_order_count,
    pay_sku_count = excluded.pay_sku_count,
    pay_qty = excluded.pay_qty,
    pay_amount = excluded.pay_amount,
    net_qty = excluded.net_qty,
    net_amount = excluded.net_amount,
    estimated_cost_amount = excluded.estimated_cost_amount,
    estimated_gross_profit = excluded.estimated_gross_profit,
    last_jst_modified = excluded.last_jst_modified,
    updated_at = excluded.updated_at;
  GET DIAGNOSTICS style_rows = ROW_COUNT;

  RETURN jsonb_build_object('hourly', hourly_rows, 'daily', daily_rows, 'sku_daily', sku_rows, 'style_daily', style_rows);
END;
$$;
