ALTER TABLE public.jst_sales_orders ADD COLUMN IF NOT EXISTS plan_delivery_date timestamptz;

-- 回填历史数据：解析 raw_data->>'plan_delivery_date'（北京时间字符串）为 UTC timestamptz
UPDATE public.jst_sales_orders
SET plan_delivery_date = (
  (raw_data->>'plan_delivery_date')::timestamp AT TIME ZONE 'Asia/Shanghai'
)
WHERE plan_delivery_date IS NULL
  AND raw_data->>'plan_delivery_date' IS NOT NULL
  AND raw_data->>'plan_delivery_date' <> '';

CREATE INDEX IF NOT EXISTS idx_jst_sales_orders_plan_delivery_date
  ON public.jst_sales_orders(plan_delivery_date);