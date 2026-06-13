-- 催货页劝退/SKU主档改造:补登记已上线对象(2026-06-13)
--
-- 背景:本套对象上周经 Supabase 直接 apply 上线、已在 staging 验证、生产(ref
--   cnwuimllzotitgsurofn)运行正常,但迁移文件未入 git。本批仅"补登记已上线对象",
--   不改生产逻辑:函数体由生产库 pg_get_functiondef 原样导出,表/索引/触发器/RLS
--   按生产 catalog(information_schema / pg_get_constraintdef / pg_get_indexdef /
--   pg_get_triggerdef / pg_policies)重建。全部语句加 if not exists / drop ... if
--   exists / create or replace 守护,保证可重复执行。
--
-- 本文件:劝退标记表 ops_chase_style_flags(+唯一索引 +RLS 4 策略)+ 供应商回填
--   触发器函数 ops_chase_style_flags_fill_supplier() + 两个触发器
--   (BEFORE INSERT 回填原供应商;BEFORE UPDATE 走既有 update_updated_at())。
--   依赖的 update_updated_at() / is_ops_internal() / has_ops_role() 由更早迁移建立。

-- ============ 1. 劝退标记表 ============
CREATE TABLE IF NOT EXISTS public.ops_chase_style_flags (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  flag text NOT NULL DEFAULT 'quantui'::text,
  style_no text,
  sku text,
  original_supplier_name text,
  remark text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_chase_style_flags_pkey PRIMARY KEY (id),
  CONSTRAINT ops_chase_style_flags_flag_chk CHECK (flag = 'quantui'::text),
  CONSTRAINT ops_chase_style_flags_target_chk
    CHECK (COALESCE(style_no, ''::text) <> ''::text OR COALESCE(sku, ''::text) <> ''::text)
);

-- ============ 2. 唯一键:同一 flag 下 (style_no, sku) 去重(NULL 归一为空串) ============
CREATE UNIQUE INDEX IF NOT EXISTS ops_chase_style_flags_uk
  ON public.ops_chase_style_flags USING btree
  (flag, COALESCE(style_no, ''::text), COALESCE(sku, ''::text));

-- ============ 3. RLS + 表级授权 ============
ALTER TABLE public.ops_chase_style_flags ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_chase_style_flags TO authenticated;
GRANT ALL ON public.ops_chase_style_flags TO service_role;

-- 策略与生产一致:作用于 public 角色(无 TO 限定);读=内部人员,写=admin 或 ops。
DROP POLICY IF EXISTS "select ops_chase_style_flags" ON public.ops_chase_style_flags;
CREATE POLICY "select ops_chase_style_flags" ON public.ops_chase_style_flags
  FOR SELECT
  USING (public.is_ops_internal((select auth.uid())));

DROP POLICY IF EXISTS "insert ops_chase_style_flags" ON public.ops_chase_style_flags;
CREATE POLICY "insert ops_chase_style_flags" ON public.ops_chase_style_flags
  FOR INSERT
  WITH CHECK (public.has_ops_role((select auth.uid()), 'admin'::public.ops_role_code)
          OR public.has_ops_role((select auth.uid()), 'ops'::public.ops_role_code));

DROP POLICY IF EXISTS "update ops_chase_style_flags" ON public.ops_chase_style_flags;
CREATE POLICY "update ops_chase_style_flags" ON public.ops_chase_style_flags
  FOR UPDATE
  USING (public.has_ops_role((select auth.uid()), 'admin'::public.ops_role_code)
      OR public.has_ops_role((select auth.uid()), 'ops'::public.ops_role_code))
  WITH CHECK (public.has_ops_role((select auth.uid()), 'admin'::public.ops_role_code)
          OR public.has_ops_role((select auth.uid()), 'ops'::public.ops_role_code));

DROP POLICY IF EXISTS "delete ops_chase_style_flags" ON public.ops_chase_style_flags;
CREATE POLICY "delete ops_chase_style_flags" ON public.ops_chase_style_flags
  FOR DELETE
  USING (public.has_ops_role((select auth.uid()), 'admin'::public.ops_role_code)
      OR public.has_ops_role((select auth.uid()), 'ops'::public.ops_role_code));

-- ============ 4. 供应商回填触发器函数(BEFORE INSERT 用) ============
CREATE OR REPLACE FUNCTION public.ops_chase_style_flags_fill_supplier()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(new.original_supplier_name, '') = '' then
    select coalesce(p.supplier_name_snapshot, sup.name) into new.original_supplier_name
    from public.ops_skus s
    left join public.ops_products p on p.id = s.product_id
    left join public.ops_suppliers sup on sup.id = coalesce(s.supplier_id, p.supplier_id)
    where (coalesce(new.sku,'') <> '' and s.sku_code = new.sku)
       or (coalesce(new.sku,'') = '' and s.style_no = new.style_no)
    order by coalesce(p.supplier_name_snapshot, sup.name) nulls last, s.updated_at desc
    limit 1;
  end if;
  return new;
end
$function$;

-- ============ 5. 触发器 ============
DROP TRIGGER IF EXISTS trg_ops_chase_style_flags_fill ON public.ops_chase_style_flags;
CREATE TRIGGER trg_ops_chase_style_flags_fill
  BEFORE INSERT ON public.ops_chase_style_flags
  FOR EACH ROW EXECUTE FUNCTION public.ops_chase_style_flags_fill_supplier();

DROP TRIGGER IF EXISTS trg_ops_chase_style_flags_updated ON public.ops_chase_style_flags;
CREATE TRIGGER trg_ops_chase_style_flags_updated
  BEFORE UPDATE ON public.ops_chase_style_flags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
