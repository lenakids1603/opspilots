
-- ============================================================
-- JST sync management tables (mock-to-DB driver layer)
-- ============================================================

-- 1) jst_sync_modules ----------------------------------------
CREATE TABLE public.jst_sync_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key text NOT NULL UNIQUE,
  module_name text NOT NULL,
  category text NOT NULL,
  sync_content text NOT NULL DEFAULT '',
  sync_frequency text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'ok', -- ok | warn | error
  last_sync_at timestamptz,
  next_sync_at timestamptz,
  last_result_summary text NOT NULL DEFAULT '',
  retry_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jst_sync_modules TO authenticated;
GRANT ALL ON public.jst_sync_modules TO service_role;

ALTER TABLE public.jst_sync_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal read jst_sync_modules"
  ON public.jst_sync_modules FOR SELECT TO authenticated
  USING (public.is_ops_internal(auth.uid()));

CREATE POLICY "admin write jst_sync_modules"
  ON public.jst_sync_modules FOR ALL TO authenticated
  USING (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code))
  WITH CHECK (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code));

CREATE TRIGGER trg_jst_sync_modules_updated
  BEFORE UPDATE ON public.jst_sync_modules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 2) jst_sync_runs -------------------------------------------
CREATE TABLE public.jst_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key text NOT NULL,
  trigger_type text NOT NULL DEFAULT 'auto', -- auto | retry | manual_backfill | manual
  status text NOT NULL DEFAULT 'running',    -- running | ok | warn | error
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  inserted_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  current_total_summary text NOT NULL DEFAULT '',
  duration_ms integer,
  error_message text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_jst_sync_runs_started_at ON public.jst_sync_runs (started_at DESC);
CREATE INDEX idx_jst_sync_runs_module_key ON public.jst_sync_runs (module_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jst_sync_runs TO authenticated;
GRANT ALL ON public.jst_sync_runs TO service_role;

ALTER TABLE public.jst_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal read jst_sync_runs"
  ON public.jst_sync_runs FOR SELECT TO authenticated
  USING (public.is_ops_internal(auth.uid()));

CREATE POLICY "internal insert jst_sync_runs"
  ON public.jst_sync_runs FOR INSERT TO authenticated
  WITH CHECK (public.is_ops_internal(auth.uid()) AND created_by = auth.uid());

CREATE POLICY "admin update jst_sync_runs"
  ON public.jst_sync_runs FOR UPDATE TO authenticated
  USING (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code))
  WITH CHECK (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code));

CREATE POLICY "admin delete jst_sync_runs"
  ON public.jst_sync_runs FOR DELETE TO authenticated
  USING (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code));

-- 3) jst_sync_metrics ----------------------------------------
CREATE TABLE public.jst_sync_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key text NOT NULL UNIQUE,
  metric_name text NOT NULL,
  metric_value text NOT NULL DEFAULT '',
  metric_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  time_range_label text NOT NULL DEFAULT '',
  data_source_label text NOT NULL DEFAULT '',
  last_sync_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jst_sync_metrics TO authenticated;
GRANT ALL ON public.jst_sync_metrics TO service_role;

ALTER TABLE public.jst_sync_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal read jst_sync_metrics"
  ON public.jst_sync_metrics FOR SELECT TO authenticated
  USING (public.is_ops_internal(auth.uid()));

CREATE POLICY "admin write jst_sync_metrics"
  ON public.jst_sync_metrics FOR ALL TO authenticated
  USING (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code))
  WITH CHECK (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code));

CREATE TRIGGER trg_jst_sync_metrics_updated
  BEFORE UPDATE ON public.jst_sync_metrics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 4) jst_sync_errors -----------------------------------------
CREATE TABLE public.jst_sync_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key text NOT NULL,
  error_level text NOT NULL DEFAULT 'warn', -- info | warn | error
  error_message text NOT NULL DEFAULT '',
  retry_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',      -- open | retrying | resolved
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX idx_jst_sync_errors_status ON public.jst_sync_errors (status);
CREATE INDEX idx_jst_sync_errors_module_key ON public.jst_sync_errors (module_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jst_sync_errors TO authenticated;
GRANT ALL ON public.jst_sync_errors TO service_role;

ALTER TABLE public.jst_sync_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal read jst_sync_errors"
  ON public.jst_sync_errors FOR SELECT TO authenticated
  USING (public.is_ops_internal(auth.uid()));

CREATE POLICY "admin write jst_sync_errors"
  ON public.jst_sync_errors FOR ALL TO authenticated
  USING (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code))
  WITH CHECK (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code));

-- ============================================================
-- Seed data (matches the static mock currently in JstDataIntegrationPage)
-- ============================================================

INSERT INTO public.jst_sync_modules
  (module_key, module_name, category, sync_content, sync_frequency, enabled, priority, status, last_sync_at, next_sync_at, last_result_summary, retry_count)
VALUES
  ('base_archive',   '基础档案',           'base',      '店铺、供应商、仓库',                          '每天凌晨 02:00 全量', true, 10, 'ok',
     date_trunc('day', now()) + interval '2 hour',
     date_trunc('day', now()) + interval '1 day 2 hour',
     '新增 0 条，更新 2 条', 0),
  ('shop',           '店铺资料 (Shop)',     'base',      '店铺基本信息',                                '每天 02:00',         true, 20, 'ok',
     date_trunc('day', now()) + interval '2 hour',
     date_trunc('day', now()) + interval '1 day 2 hour',
     '新增 0 条，更新 2 条', 0),
  ('product',        '商品资料 (Product)',  'product',   '款式档案、分类',                               '每 30 分钟',         true, 30, 'ok',
     now() - interval '15 minute',
     now() + interval '15 minute',
     '新增 15 条，更新 3 条', 0),
  ('sku',            'SKU 资料 (SKU)',     'product',   '条码、规格',                                   '每 30 分钟',         true, 40, 'warn',
     now() - interval '15 minute',
     now() + interval '15 minute',
     '4 条失败，原因：API Rate Limit', 1),
  ('purchase',       '采购与入库',          'purchase',  '采购单、采购入库单',                           '每 10 分钟',         true, 50, 'ok',
     now() - interval '5 minute',
     now() + interval '5 minute',
     '新增 2 单', 0),
  ('inventory',      '基础库存 (Inventory)','inventory', '基础库存、可用库存、锁定库存',                  '每 10 分钟 全量',     true, 60, 'error',
     now() - interval '10 minute',
     now() + interval '2 minute',
     '同步超时，自动重试中', 1),
  ('sales_refund',   '销售与退款',          'sales',     'GMV、GSV、退款金额、订单数、退款率',           '每 10 分钟 增量',     true, 70, 'ok',
     now() - interval '1 minute',
     now() + interval '9 minute',
     '新增 15 单 / ¥320 GMV', 0);

INSERT INTO public.jst_sync_metrics
  (metric_key, metric_name, metric_value, metric_extra, time_range_label, data_source_label, last_sync_at)
VALUES
  ('global_status',       '全局同步状态',     '部分异常',
     jsonb_build_object('auto_enabled', true, 'next_sync_at', to_char(now() + interval '10 minute','HH24:MI'), 'today_batches', 42, 'today_records', 1242, 'success_records', 1240, 'failed_records', 2, 'running', 0),
     '今日 00:00 - 当前', '聚水潭经营口径', now() - interval '1 minute'),
  ('base_archive_summary', '基础档案概览',     '',
     jsonb_build_object('shops', 36, 'suppliers', 6, 'warehouses', 2, 'status', 'warn'),
     '当前',               '聚水潭经营口径', date_trunc('day', now()) + interval '2 hour'),
  ('product_summary',      '商品与 SKU 概览',  '',
     jsonb_build_object('products', 680, 'skus', 679, 'image_cache', '100%', 'status', 'ok'),
     '当前',               '聚水潭经营口径', now() - interval '1 minute'),
  ('purchase_summary',     '采购与入库概览',   '',
     jsonb_build_object('today_po', 36, 'today_io', 22, 'io_errors', 0, 'status', 'ok'),
     '今日 00:00 - 当前',  '聚水潭经营口径', now() - interval '5 minute'),
  ('inventory_summary',    '库存概览',         '',
     jsonb_build_object('stock_skus', 679, 'errors', 1, 'status', 'error'),
     '当前',               '聚水潭经营口径', now() - interval '10 minute'),
  ('sales_summary',        '销售与退款概览',   '',
     jsonb_build_object('today_gmv', 12000, 'today_gsv', 11000, 'today_refund', 1000, 'today_orders', 128, 'refund_rate', 8.3, 'active_shops', 12, 'sync_delta_orders', 15, 'sync_delta_gmv', 320, 'status', 'ok'),
     '今日 00:00 - 当前',  '聚水潭经营口径', now() - interval '1 minute'),
  ('fulfillment_summary',  '履约与售后概览',   '',
     jsonb_build_object('pending_shipment', 116, 'overdue_shipment', 8, 'today_aftersales', 12, 'status', 'ok'),
     '今日 00:00 - 当前',  '聚水潭经营口径', now() - interval '5 minute');

INSERT INTO public.jst_sync_errors
  (module_key, error_level, error_message, retry_count, status, first_seen_at, last_seen_at)
VALUES
  ('inventory', 'error', 'Connection Timeout（基础库存同步超时）', 1, 'retrying', now() - interval '20 minute', now() - interval '10 minute'),
  ('sku',       'warn',  'API Rate Limit Exceeded（4 条 SKU 同步失败）', 1, 'retrying', now() - interval '40 minute', now() - interval '15 minute');

INSERT INTO public.jst_sync_runs
  (module_key, trigger_type, status, started_at, finished_at, inserted_count, updated_count, failed_count, current_total_summary, duration_ms, error_message)
VALUES
  ('sales_refund', 'auto',  'ok',    now() - interval '1 minute',  now() - interval '1 minute' + interval '1200 millisecond', 15, 3, 0, '今日 GMV ¥12,000', 1200, ''),
  ('sku',          'retry', 'error', now() - interval '2 minute',  now() - interval '2 minute' + interval '800 millisecond',   0, 0, 4, 'SKU 总数 679',     800,  'API Rate Limit Exceeded'),
  ('purchase',     'auto',  'ok',    now() - interval '6 minute',  now() - interval '6 minute' + interval '500 millisecond',   2, 0, 0, '今日采购单 36',    500,  ''),
  ('inventory',    'auto',  'error', now() - interval '11 minute', now() - interval '11 minute' + interval '30 second',        0, 0, 0, '库存 SKU 679',     30000, 'Connection Timeout');
