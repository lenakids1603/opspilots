-- 商品档案供应商沉淀(2026-06-12)
--
-- 背景:催货/风险表的供应商归属优先走 ops_products 档案
-- (style_no → supplier_name_snapshot),档案为空时才实时兜底取最近采购单
-- (ops_chase_refresh_risk_meta 的 supplier_from_po 路径)。3-5 月老款档案
-- 普遍无供应商,归属完全依赖实时关联。本函数把"该款最近一张有效采购单的
-- 供应商"常态化回填进档案,由 ops-product-master-derive 每次运行时调用,
-- 让归属逐步沉淀、不再完全依赖实时关联。
--
-- 规则:
--   * 仅回填 supplier_id IS NULL 且 supplier_name_snapshot 为空的档案行
--     (jst-sync-products 会用 JST 商品资料无条件覆盖这两个字段——包括置空,
--     档案有值时以 JST 资料为准,被置空后下次 derive 会再次沉淀);
--   * 同款多供应商时取 po_date 最近的一张(与风险表兜底口径一致);
--   * 排除 Delete/Cancelled 采购单(已取消的单不代表在续供货关系);
--   * 款号匹配:档案 style_no 优先,空则用 code(两者通常都是 JST i_id)。

CREATE OR REPLACE FUNCTION public.ops_products_backfill_supplier_from_po()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.ops_products p
  SET supplier_id = m.supplier_id,
      supplier_name_snapshot = m.supplier_name,
      updated_at = now()
  FROM (
    SELECT DISTINCT ON (poi.style_no)
           poi.style_no, po.supplier_id, po.supplier_name
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
    WHERE coalesce(po.supplier_name, '') <> ''
      AND coalesce(poi.style_no, '') <> ''
      AND coalesce(po.status, '') NOT IN ('Delete', 'Cancelled')
    ORDER BY poi.style_no, po.po_date DESC NULLS LAST, po.id
  ) m
  WHERE coalesce(nullif(p.style_no, ''), p.code) = m.style_no
    AND p.supplier_id IS NULL
    AND coalesce(p.supplier_name_snapshot, '') = '';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('products_supplier_backfilled', v_updated);
END
$$;

COMMENT ON FUNCTION public.ops_products_backfill_supplier_from_po() IS
  '商品档案供应商沉淀:档案 supplier 为空时取该款最近一张有效采购单的供应商回填。由 ops-product-master-derive 常态调用。';

REVOKE ALL ON FUNCTION public.ops_products_backfill_supplier_from_po() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_products_backfill_supplier_from_po() FROM anon;
REVOKE ALL ON FUNCTION public.ops_products_backfill_supplier_from_po() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ops_products_backfill_supplier_from_po() TO service_role;
