-- 修复历史聚水潭业务日期:之前同步把"2026-06-01 17:39:29"(北京时间)当成 UTC 存储,
-- 导致整体偏移 +8 小时(显示为北京 6/2 01:39)。
-- 重新按 Asia/Shanghai 解析 raw 中的原始字符串,得到正确的 UTC 时间。

UPDATE public.purchase_orders
SET po_date = (raw->>'po_date')::timestamp AT TIME ZONE 'Asia/Shanghai'
WHERE po_date IS NOT NULL
  AND raw ? 'po_date'
  AND po_date = (raw->>'po_date')::timestamptz;

UPDATE public.purchase_orders
SET jst_modified_at = (raw->>'modified')::timestamp AT TIME ZONE 'Asia/Shanghai'
WHERE jst_modified_at IS NOT NULL
  AND raw ? 'modified'
  AND jst_modified_at = (raw->>'modified')::timestamptz;

UPDATE public.purchase_order_items
SET delivery_date = (raw->>'delivery_date')::timestamp AT TIME ZONE 'Asia/Shanghai'
WHERE delivery_date IS NOT NULL
  AND raw ? 'delivery_date'
  AND delivery_date = (raw->>'delivery_date')::timestamptz;

UPDATE public.purchase_receipts
SET io_date = (raw->>'io_date')::timestamp AT TIME ZONE 'Asia/Shanghai'
WHERE io_date IS NOT NULL
  AND raw ? 'io_date'
  AND io_date = (raw->>'io_date')::timestamptz;

UPDATE public.purchase_receipts
SET jst_modified_at = (raw->>'modified')::timestamp AT TIME ZONE 'Asia/Shanghai'
WHERE jst_modified_at IS NOT NULL
  AND raw ? 'modified'
  AND jst_modified_at = (raw->>'modified')::timestamptz;