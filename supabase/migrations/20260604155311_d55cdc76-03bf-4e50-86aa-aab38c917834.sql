
-- 1. 扩展 ops_skus 主档字段
ALTER TABLE public.ops_skus
  ADD COLUMN IF NOT EXISTS style_no text,
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS season text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS source text;

CREATE INDEX IF NOT EXISTS idx_ops_skus_style_no ON public.ops_skus(style_no);
CREATE INDEX IF NOT EXISTS idx_ops_skus_sku_code ON public.ops_skus(sku_code);

-- 2. 扩展 ops_sku_aliases 线上映射字段
ALTER TABLE public.ops_sku_aliases
  ADD COLUMN IF NOT EXISTS shop_name text,
  ADD COLUMN IF NOT EXISTS online_product_name text,
  ADD COLUMN IF NOT EXISTS online_sku_name text,
  ADD COLUMN IF NOT EXISTS online_status text,
  ADD COLUMN IF NOT EXISTS modified_at timestamptz,
  ADD COLUMN IF NOT EXISTS raw_data jsonb;

-- 3. 新建商品映射异常表
CREATE TABLE IF NOT EXISTS public.ops_product_mapping_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text,
  shop_id text,
  shop_name text,
  online_item_code text,
  online_sku_code text,
  jst_sku_id text,
  order_no text,
  source_table text,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  raw_data jsonb,
  resolved_sku_id uuid REFERENCES public.ops_skus(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_product_mapping_exceptions_key
  ON public.ops_product_mapping_exceptions(
    COALESCE(shop_id,''), COALESCE(online_sku_code,''), COALESCE(jst_sku_id,'')
  ) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_ops_product_mapping_exceptions_status
  ON public.ops_product_mapping_exceptions(status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_product_mapping_exceptions TO authenticated;
GRANT ALL ON public.ops_product_mapping_exceptions TO service_role;

ALTER TABLE public.ops_product_mapping_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ops_internal_read_mapping_exceptions"
  ON public.ops_product_mapping_exceptions FOR SELECT
  TO authenticated
  USING (public.is_ops_internal(auth.uid()));

CREATE POLICY "ops_admin_write_mapping_exceptions"
  ON public.ops_product_mapping_exceptions FOR ALL
  TO authenticated
  USING (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code))
  WITH CHECK (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code));

CREATE TRIGGER trg_ops_product_mapping_exceptions_updated
  BEFORE UPDATE ON public.ops_product_mapping_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
