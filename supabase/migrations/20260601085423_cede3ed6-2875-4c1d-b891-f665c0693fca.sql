-- 销售退款原始数据表
CREATE TABLE public.jst_sales_refund_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id uuid,
  record_type text NOT NULL CHECK (record_type IN ('order','refund')),
  jst_shop_id text NOT NULL DEFAULT '',
  matched_shop_id uuid,
  matched_business_entity_id uuid,
  matched_platform_id uuid,
  mapping_status text NOT NULL DEFAULT 'unmapped',
  jst_order_id text NOT NULL DEFAULT '',
  platform_order_id text NOT NULL DEFAULT '',
  refund_id text NOT NULL DEFAULT '',
  sku_id text NOT NULL DEFAULT '',
  sku_code text NOT NULL DEFAULT '',
  product_code text NOT NULL DEFAULT '',
  product_name text NOT NULL DEFAULT '',
  order_paid_at timestamptz,
  refund_completed_at timestamptz,
  order_amount numeric NOT NULL DEFAULT 0,
  refund_amount numeric NOT NULL DEFAULT 0,
  order_status text NOT NULL DEFAULT '',
  refund_status text NOT NULL DEFAULT '',
  raw_json jsonb,
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_jst_srr_run ON public.jst_sales_refund_raw(sync_run_id);
CREATE INDEX idx_jst_srr_shop ON public.jst_sales_refund_raw(jst_shop_id, record_type);
CREATE INDEX idx_jst_srr_order ON public.jst_sales_refund_raw(jst_order_id);
CREATE INDEX idx_jst_srr_refund ON public.jst_sales_refund_raw(refund_id);
CREATE INDEX idx_jst_srr_paid ON public.jst_sales_refund_raw(order_paid_at);
CREATE INDEX idx_jst_srr_refund_at ON public.jst_sales_refund_raw(refund_completed_at);
CREATE UNIQUE INDEX uniq_jst_srr_order ON public.jst_sales_refund_raw(jst_order_id, sku_code) WHERE record_type = 'order' AND jst_order_id <> '';
CREATE UNIQUE INDEX uniq_jst_srr_refund ON public.jst_sales_refund_raw(refund_id, sku_code) WHERE record_type = 'refund' AND refund_id <> '';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jst_sales_refund_raw TO authenticated;
GRANT ALL ON public.jst_sales_refund_raw TO service_role;

ALTER TABLE public.jst_sales_refund_raw ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal read jst_sales_refund_raw" ON public.jst_sales_refund_raw
  FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));
CREATE POLICY "admin write jst_sales_refund_raw" ON public.jst_sales_refund_raw
  FOR ALL TO authenticated
  USING (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code))
  WITH CHECK (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code));

-- 销售退款每日汇总表
CREATE TABLE public.jst_sales_refund_daily_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_date date NOT NULL,
  shop_id uuid NOT NULL,
  business_entity_id uuid NOT NULL,
  platform_id uuid NOT NULL,
  gmv_amount numeric NOT NULL DEFAULT 0,
  gsv_amount numeric NOT NULL DEFAULT 0,
  refund_amount numeric NOT NULL DEFAULT 0,
  order_count integer NOT NULL DEFAULT 0,
  refund_count integer NOT NULL DEFAULT 0,
  refund_rate numeric NOT NULL DEFAULT 0,
  data_source_label text NOT NULL DEFAULT '聚水潭经营口径',
  generated_from_run_id uuid,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uniq_jst_srds_day_shop ON public.jst_sales_refund_daily_summary(summary_date, shop_id);
CREATE INDEX idx_jst_srds_day ON public.jst_sales_refund_daily_summary(summary_date);
CREATE INDEX idx_jst_srds_entity ON public.jst_sales_refund_daily_summary(business_entity_id);
CREATE INDEX idx_jst_srds_platform ON public.jst_sales_refund_daily_summary(platform_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jst_sales_refund_daily_summary TO authenticated;
GRANT ALL ON public.jst_sales_refund_daily_summary TO service_role;

ALTER TABLE public.jst_sales_refund_daily_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal read jst_sales_refund_daily_summary" ON public.jst_sales_refund_daily_summary
  FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));
CREATE POLICY "admin write jst_sales_refund_daily_summary" ON public.jst_sales_refund_daily_summary
  FOR ALL TO authenticated
  USING (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code))
  WITH CHECK (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code));

CREATE TRIGGER trg_jst_srds_updated
  BEFORE UPDATE ON public.jst_sales_refund_daily_summary
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
