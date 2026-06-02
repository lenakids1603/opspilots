-- Backfill expected_delivery_date from items max(delivery_date) for non-deleted purchase orders
UPDATE public.purchase_orders po
SET expected_delivery_date = sub.max_dd
FROM (
  SELECT purchase_order_id, MAX(delivery_date) AS max_dd
  FROM public.purchase_order_items
  WHERE delivery_date IS NOT NULL
  GROUP BY purchase_order_id
) sub
WHERE po.id = sub.purchase_order_id
  AND (po.expected_delivery_date IS NULL OR po.expected_delivery_date <> sub.max_dd);

-- Helpful index for filtering out deleted POs
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON public.purchase_orders (status);