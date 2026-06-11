-- SKU 图片字典回填 + 配图链路打通（2026-06-11）
--
-- 现状：jst_sales/refund/outbound_order_items 的 pic 字段 100% 携带抖音图床
-- (ecombdimg) 图片 URL，覆盖 5,814 个有交易 SKU；但 ops_skus / ops_products
-- 均为空表，v_purchase_order_items_with_image 的 resolved_image_url 解析率 0。
-- 商家 SKU 编码在明细表的 sku_id 字段（sku_code 历史数据恒为空），款号在 i_id。
-- 注意：ops_skus.product_id 为 NOT NULL，必须先建款号档案再插 SKU；
-- 明细缺款号时用 SKU 本身兜底作款号（refund 明细无 i_id）。
--
-- 变更内容：
--   1) 新增 ops_sku_image_dict_upsert(_rows jsonb)：fill-if-empty 维护
--      ops_skus（键 sku_code=商家SKU）与 ops_products（键 code=款号）的
--      external_image_url。销售明细同步每页顺手调用（增量维持，不另起调度）。
--   2) 一次性回填：三张明细表按 sku_id 取最新非空 pic（销售优先，退款、
--      出库兜底）写入 ops_products + ops_skus。仅回填有图 SKU，不做全量。
--   3) 新增 ops_sku_images(_skus text[])：按 SKU 数组批量取图（催货清单等
--      页面用），优先级与 v_purchase_order_items_with_image 一致。
--   4) 不下载图片文件、不占 Storage：第一阶段全部热链抖音图床，
--      image_storage_path 留空备用。
--   5) v_purchase_order_items_with_image 本身无需改：它已按
--      s.sku_code = poi.sku_no 联 ops_skus，字典有数据后即解析成功。
--
-- 本文件用 -- @@SPLIT@@ 注释分块，便于 Management API 分段执行（请求体≤4KB）。

-- @@SPLIT@@ ============ 1. 字典维护 RPC（同步增量调用） ============
CREATE OR REPLACE FUNCTION public.ops_sku_image_dict_upsert(_rows jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_skus int;
BEGIN
  -- 1) 款号档案（同款取任一 SKU 图；款号缺失用 SKU 本身兜底）
  INSERT INTO public.ops_products (code, name, style_no, product_name, external_image_url)
  SELECT DISTINCT ON (t.st) t.st, coalesce(nullif(t.product_name, ''), t.st),
         t.st, nullif(t.product_name, ''), t.pic
  FROM (
    SELECT coalesce(nullif(r.style_no, ''), r.sku) AS st, r.product_name, r.pic
    FROM jsonb_to_recordset(_rows) AS r(sku text, pic text, style_no text, product_name text)
    WHERE coalesce(r.sku, '') <> '' AND coalesce(r.pic, '') <> ''
  ) t
  ON CONFLICT (code) DO UPDATE SET
    external_image_url = coalesce(nullif(ops_products.external_image_url, ''), excluded.external_image_url),
    style_no = coalesce(nullif(ops_products.style_no, ''), excluded.style_no);

  -- 2) SKU 维度：已有图/已有档案字段不覆盖，只补空；product_id 非空约束由 join 保证
  INSERT INTO public.ops_skus (product_id, sku_code, jst_sku_id, style_no, product_name, sku_name,
                               external_image_url, source, first_seen_at, last_seen_at, last_synced_at)
  SELECT p.id, t.sku, t.sku, nullif(t.style_no, ''), nullif(t.product_name, ''),
         nullif(t.product_name, ''), t.pic, 'sales', now(), now(), now()
  FROM (
    SELECT DISTINCT ON (r.sku) r.sku, r.pic, r.style_no, r.product_name,
           coalesce(nullif(r.style_no, ''), r.sku) AS st
    FROM jsonb_to_recordset(_rows) AS r(sku text, pic text, style_no text, product_name text)
    WHERE coalesce(r.sku, '') <> '' AND coalesce(r.pic, '') <> ''
  ) t
  JOIN public.ops_products p ON p.code = t.st
  ON CONFLICT (sku_code) DO UPDATE SET
    external_image_url = coalesce(nullif(ops_skus.external_image_url, ''), excluded.external_image_url),
    style_no = coalesce(nullif(ops_skus.style_no, ''), excluded.style_no),
    product_name = coalesce(ops_skus.product_name, excluded.product_name),
    jst_sku_id = coalesce(ops_skus.jst_sku_id, excluded.jst_sku_id),
    last_seen_at = now(), last_synced_at = now();
  GET DIAGNOSTICS v_skus = ROW_COUNT;

  RETURN v_skus;
END
$$;

REVOKE ALL ON FUNCTION public.ops_sku_image_dict_upsert(jsonb) FROM public;
REVOKE ALL ON FUNCTION public.ops_sku_image_dict_upsert(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.ops_sku_image_dict_upsert(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ops_sku_image_dict_upsert(jsonb) TO service_role;

-- @@SPLIT@@ ============ 2. 一次性回填：ops_products（款号 → 任一 SKU 图） ============
WITH src AS (
  SELECT DISTINCT ON (u.sku_id) u.sku_id, u.pic, u.style_no, u.product_name,
         coalesce(nullif(u.style_no, ''), u.sku_id) AS st
  FROM (
    SELECT sku_id, pic, i_id AS style_no, coalesce(nullif(product_name, ''), sku_name) AS product_name,
           1 AS pri, synced_at
    FROM public.jst_sales_order_items
    WHERE coalesce(sku_id, '') <> '' AND coalesce(pic, '') <> ''
    UNION ALL
    SELECT sku_id, pic, NULL, name, 2, synced_at
    FROM public.jst_refund_order_items
    WHERE coalesce(sku_id, '') <> '' AND coalesce(pic, '') <> ''
    UNION ALL
    SELECT sku_id, pic, i_id, name, 3, synced_at
    FROM public.jst_outbound_order_items
    WHERE coalesce(sku_id, '') <> '' AND coalesce(pic, '') <> ''
  ) u
  ORDER BY u.sku_id, u.pri, u.synced_at DESC NULLS LAST
)
INSERT INTO public.ops_products (code, name, style_no, product_name, external_image_url)
SELECT DISTINCT ON (s.st) s.st, coalesce(nullif(s.product_name, ''), s.st),
       s.st, nullif(s.product_name, ''), s.pic
FROM src s
ORDER BY s.st, s.sku_id
ON CONFLICT (code) DO UPDATE SET
  external_image_url = coalesce(nullif(ops_products.external_image_url, ''), excluded.external_image_url),
  style_no = coalesce(nullif(ops_products.style_no, ''), excluded.style_no);

-- @@SPLIT@@ ============ 3. 一次性回填：ops_skus（销售优先，退款/出库兜底） ============
WITH src AS (
  SELECT DISTINCT ON (u.sku_id) u.sku_id, u.pic, u.style_no, u.product_name,
         coalesce(nullif(u.style_no, ''), u.sku_id) AS st
  FROM (
    SELECT sku_id, pic, i_id AS style_no, coalesce(nullif(product_name, ''), sku_name) AS product_name,
           1 AS pri, synced_at
    FROM public.jst_sales_order_items
    WHERE coalesce(sku_id, '') <> '' AND coalesce(pic, '') <> ''
    UNION ALL
    SELECT sku_id, pic, NULL, name, 2, synced_at
    FROM public.jst_refund_order_items
    WHERE coalesce(sku_id, '') <> '' AND coalesce(pic, '') <> ''
    UNION ALL
    SELECT sku_id, pic, i_id, name, 3, synced_at
    FROM public.jst_outbound_order_items
    WHERE coalesce(sku_id, '') <> '' AND coalesce(pic, '') <> ''
  ) u
  ORDER BY u.sku_id, u.pri, u.synced_at DESC NULLS LAST
)
INSERT INTO public.ops_skus (product_id, sku_code, jst_sku_id, style_no, product_name, sku_name,
                             external_image_url, source, first_seen_at, last_seen_at, last_synced_at)
SELECT p.id, s.sku_id, s.sku_id, nullif(s.style_no, ''), nullif(s.product_name, ''),
       nullif(s.product_name, ''), s.pic, 'image_backfill', now(), now(), now()
FROM src s
JOIN public.ops_products p ON p.code = s.st
ON CONFLICT (sku_code) DO UPDATE SET
  external_image_url = coalesce(nullif(ops_skus.external_image_url, ''), excluded.external_image_url),
  style_no = coalesce(nullif(ops_skus.style_no, ''), excluded.style_no),
  last_synced_at = now();

-- @@SPLIT@@ ============ 4. 批量取图 RPC（催货清单等页面用） ============
CREATE OR REPLACE FUNCTION public.ops_sku_images(_skus text[])
RETURNS TABLE (sku text, image_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.sku,
         coalesce(nullif(s.sku_image_url, ''), nullif(p.main_image_url, ''),
                  nullif(s.external_image_url, ''), nullif(p.external_image_url, ''))
  FROM unnest(_skus) AS q(sku)
  LEFT JOIN public.ops_skus s ON s.sku_code = q.sku
  LEFT JOIN public.ops_products p ON p.id = s.product_id
$$;

COMMENT ON FUNCTION public.ops_sku_images(text[]) IS
  '按 SKU 数组批量取图。优先级同 v_purchase_order_items_with_image：sku_image_url → 商品 main_image_url → SKU 外链图 → 商品外链图；未收录的 SKU 返回 image_url=NULL。';

REVOKE ALL ON FUNCTION public.ops_sku_images(text[]) FROM public;
REVOKE ALL ON FUNCTION public.ops_sku_images(text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.ops_sku_images(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_sku_images(text[]) TO service_role;
