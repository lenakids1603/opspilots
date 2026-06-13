-- 催货页劝退/SKU主档改造:补登记已上线对象(2026-06-13)
--
-- 本文件:ops_chase_quantui_skus() —— 把 ops_chase_style_flags 里的劝退标记
--   (按 sku 精确、或按 style_no 款号)展开成受影响的 SKU 集合,供催采购清单
--   标注、催供应商/未匹配清单排除使用。函数体由生产库 pg_get_functiondef 原样导出。
--
-- 依赖 ops_chase_style_flags(见 20260613060000)与 ops_skus,故排在其后。
-- 授权:与生产一致,沿用新建函数的 Supabase 默认 EXECUTE 授权(不额外 REVOKE/GRANT)。

CREATE OR REPLACE FUNCTION public.ops_chase_quantui_skus()
 RETURNS TABLE(sku text, original_supplier_name text, remark text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.sku_code as sku,
         max(f.original_supplier_name) as original_supplier_name,
         max(f.remark) as remark
  from public.ops_chase_style_flags f
  join public.ops_skus s
    on (coalesce(f.sku,'') <> '' and s.sku_code = f.sku)
    or (coalesce(f.sku,'') = '' and coalesce(f.style_no,'') <> '' and s.style_no = f.style_no)
  where f.flag = 'quantui'
  group by s.sku_code
$function$;
