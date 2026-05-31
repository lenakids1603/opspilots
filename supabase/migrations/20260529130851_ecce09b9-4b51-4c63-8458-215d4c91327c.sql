
-- ① ops_products 加字段
ALTER TABLE public.ops_products
  ADD COLUMN IF NOT EXISTS jst_product_id text,
  ADD COLUMN IF NOT EXISTS style_no text,
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS supplier_name_snapshot text,
  ADD COLUMN IF NOT EXISTS season text,
  ADD COLUMN IF NOT EXISTS year int,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS age_range text,
  ADD COLUMN IF NOT EXISTS main_image_url text,
  ADD COLUMN IF NOT EXISTS external_image_url text,
  ADD COLUMN IF NOT EXISTS image_storage_path text,
  ADD COLUMN IF NOT EXISTS cost_price numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sale_price numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS raw_jst_json jsonb,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS ops_products_jst_id_uk ON public.ops_products(jst_product_id) WHERE jst_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ops_products_style_no_idx ON public.ops_products(style_no);

-- ② ops_skus 加字段
ALTER TABLE public.ops_skus
  ADD COLUMN IF NOT EXISTS jst_sku_id text,
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS size text,
  ADD COLUMN IF NOT EXISTS spec_name text,
  ADD COLUMN IF NOT EXISTS sku_name text,
  ADD COLUMN IF NOT EXISTS supplier_id uuid,
  ADD COLUMN IF NOT EXISTS sku_image_url text,
  ADD COLUMN IF NOT EXISTS external_image_url text,
  ADD COLUMN IF NOT EXISTS image_storage_path text,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS raw_jst_json jsonb,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS ops_skus_jst_id_uk ON public.ops_skus(jst_sku_id) WHERE jst_sku_id IS NOT NULL;

-- ③ ops_sku_aliases 新表 + GRANTs + RLS
CREATE TABLE IF NOT EXISTS public.ops_sku_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id uuid REFERENCES public.ops_skus(id) ON DELETE CASCADE,
  platform text,
  shop_id text,
  external_product_id text,
  external_sku_id text,
  external_sku_code text,
  barcode text,
  jst_sku_id text,
  alias_type text NOT NULL,
  is_primary boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_sku_aliases TO authenticated;
GRANT ALL ON public.ops_sku_aliases TO service_role;
ALTER TABLE public.ops_sku_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "internal full aliases" ON public.ops_sku_aliases;
CREATE POLICY "internal full aliases" ON public.ops_sku_aliases
  FOR ALL TO authenticated USING (is_ops_internal(auth.uid())) WITH CHECK (is_ops_internal(auth.uid()));
CREATE UNIQUE INDEX IF NOT EXISTS ops_sku_aliases_uk
  ON public.ops_sku_aliases(alias_type, external_sku_code) WHERE external_sku_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ops_sku_aliases_sku_idx ON public.ops_sku_aliases(sku_id);

-- ④ Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images','product-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "product-images public read" ON storage.objects;
CREATE POLICY "product-images public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'product-images');
DROP POLICY IF EXISTS "product-images internal write" ON storage.objects;
CREATE POLICY "product-images internal write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images' AND is_ops_internal(auth.uid()));
DROP POLICY IF EXISTS "product-images internal update" ON storage.objects;
CREATE POLICY "product-images internal update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images' AND is_ops_internal(auth.uid()));
DROP POLICY IF EXISTS "product-images internal delete" ON storage.objects;
CREATE POLICY "product-images internal delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'product-images' AND is_ops_internal(auth.uid()));

-- ⑤ 视图：采购单明细附图片
CREATE OR REPLACE VIEW public.v_purchase_order_items_with_image AS
SELECT poi.*,
  COALESCE(
    NULLIF(s.sku_image_url, ''),
    NULLIF(p.main_image_url, ''),
    NULLIF(s.external_image_url, ''),
    NULLIF(p.external_image_url, ''),
    NULLIF(poi.product_image_url, '')
  ) AS resolved_image_url,
  s.color AS sku_color,
  s.size AS sku_size,
  p.style_no AS resolved_style_no,
  p.product_name AS resolved_product_name
FROM public.purchase_order_items poi
LEFT JOIN public.ops_skus s ON s.sku_code = poi.sku_no
LEFT JOIN public.ops_products p ON p.id = s.product_id;

GRANT SELECT ON public.v_purchase_order_items_with_image TO authenticated;
GRANT SELECT ON public.v_purchase_order_items_with_image TO service_role;
