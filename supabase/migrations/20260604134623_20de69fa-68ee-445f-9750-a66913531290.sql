
-- 复用 shops.status (active/disabled) 作为业务状态;新增订单同步开关与停用原因
ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS is_order_sync_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS disabled_reason text,
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_shops_sync_active
  ON public.shops(status, is_order_sync_enabled) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shops_jst_shop_id ON public.shops(jst_shop_id) WHERE deleted_at IS NULL;
