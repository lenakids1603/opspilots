-- 新增 4 个售后 API 自动同步计划（idempotent upsert，不影响已有 7 个计划）
INSERT INTO public.jst_sync_modules
  (module_key, module_name, category, sync_content, sync_frequency, enabled, priority, status)
VALUES
  ('refund_orders',                  '退货退款单',        'aftersale', '聚水潭退货退款单（退款金额/状态/原因）',          '每天 03:10 同步最近 2 天',  true, 80, 'ok'),
  ('aftersale_received',             '销售退仓',          'aftersale', '聚水潭销售退仓（仓库实际收货 SKU 与数量）',       '每天 03:30 同步最近 2 天',  true, 81, 'ok'),
  ('refund_orders_backfill_7d',      '退货退款单补偿同步', 'aftersale', '退货退款单补偿，覆盖状态延迟更新',                 '每天 04:10 同步最近 7 天',  true, 82, 'ok'),
  ('aftersale_received_backfill_7d', '销售退仓补偿同步',   'aftersale', '销售退仓补偿，覆盖晚到的实际收货数据',             '每天 04:30 同步最近 7 天',  true, 83, 'ok')
ON CONFLICT (module_key) DO UPDATE SET
  module_name    = EXCLUDED.module_name,
  category       = EXCLUDED.category,
  sync_content   = EXCLUDED.sync_content,
  sync_frequency = EXCLUDED.sync_frequency,
  enabled        = EXCLUDED.enabled,
  priority       = EXCLUDED.priority,
  updated_at     = now();