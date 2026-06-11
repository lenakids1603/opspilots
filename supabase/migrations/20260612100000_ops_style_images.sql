-- 款图批量取图 RPC（2026-06-11）
--
-- 货期交付看板（运营端）与供应商门户工作台的货期时间轴改商品缩略图，
-- 需要按款号批量取 ops_products 的款名/款图。ops_products 的 RLS 只放行
-- 内部用户或 supplier_id 匹配的行，而图片回填产生的款号档案 supplier_id
-- 为空，供应商账号直查取不到；故仿照 ops_sku_images 提供 SECURITY DEFINER
-- 批量字典接口，只返回款号/款名/款图三列，不含价格成本等敏感字段。
-- 图片优先级：main_image_url → external_image_url；未收录款号返回 NULL。

CREATE OR REPLACE FUNCTION public.ops_style_images(_style_nos text[])
RETURNS TABLE (style_no text, product_name text, image_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.style_no,
         coalesce(nullif(p.product_name, ''),
                  CASE WHEN p.name <> p.code THEN p.name END),
         coalesce(nullif(p.main_image_url, ''), nullif(p.external_image_url, ''))
  FROM unnest(_style_nos) AS q(style_no)
  LEFT JOIN public.ops_products p ON p.code = q.style_no
$$;

COMMENT ON FUNCTION public.ops_style_images(text[]) IS
  '按款号数组批量取款名/款图（ops_products，code=款号；图片 main_image_url 优先、external_image_url 兜底）。货期交付看板 / 供应商工作台时间轴缩略图用；未收录款号返回 NULL。';

REVOKE ALL ON FUNCTION public.ops_style_images(text[]) FROM public;
REVOKE ALL ON FUNCTION public.ops_style_images(text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.ops_style_images(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_style_images(text[]) TO service_role;

NOTIFY pgrst, 'reload schema';
