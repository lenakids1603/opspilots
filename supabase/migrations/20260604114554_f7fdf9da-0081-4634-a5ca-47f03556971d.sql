
-- ===== jst_refund_order_items =====
DROP INDEX IF EXISTS public.uq_jst_refund_items_asi;
DROP INDEX IF EXISTS public.uq_jst_refund_items_sku;

UPDATE public.jst_refund_order_items
SET item_unique_key = COALESCE(
  NULLIF(item_unique_key,''),
  concat_ws('|', as_id, COALESCE(asi_id,''), COALESCE(sku_id,''), COALESCE(outer_oi_id,''), COALESCE(type,''))
)
WHERE item_unique_key IS NULL OR item_unique_key = '';

-- dedup any rows that share the same item_unique_key, keep oldest
DELETE FROM public.jst_refund_order_items a
USING public.jst_refund_order_items b
WHERE a.item_unique_key = b.item_unique_key
  AND a.ctid > b.ctid;

ALTER TABLE public.jst_refund_order_items ALTER COLUMN item_unique_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS jst_refund_order_items_item_unique_key_idx
  ON public.jst_refund_order_items(item_unique_key);

CREATE INDEX IF NOT EXISTS idx_jst_refund_items_as_asi
  ON public.jst_refund_order_items(as_id, asi_id);

-- ===== jst_aftersale_received_orders =====
ALTER TABLE public.jst_aftersale_received_orders
  DROP CONSTRAINT IF EXISTS jst_aftersale_received_orders_as_id_key;
DROP INDEX IF EXISTS public.jst_aftersale_received_orders_as_id_key;

UPDATE public.jst_aftersale_received_orders
SET received_unique_key = COALESCE(
  NULLIF(received_unique_key,''),
  NULLIF(io_id,''), NULLIF(as_id,''), NULLIF(outer_as_id,''), id::text
)
WHERE received_unique_key IS NULL OR received_unique_key = '';

-- ensure non-partial unique index
DROP INDEX IF EXISTS public.jst_aftersale_received_orders_unique_key_idx;
CREATE UNIQUE INDEX jst_aftersale_received_orders_unique_key_idx
  ON public.jst_aftersale_received_orders(received_unique_key);

-- ===== jst_aftersale_received_items =====
ALTER TABLE public.jst_aftersale_received_items
  DROP CONSTRAINT IF EXISTS uq_jst_aftersale_recv_items;
DROP INDEX IF EXISTS public.uq_jst_aftersale_recv_items;

ALTER TABLE public.jst_aftersale_received_items ALTER COLUMN as_id DROP NOT NULL;

UPDATE public.jst_aftersale_received_items
SET item_unique_key = COALESCE(NULLIF(item_unique_key,''), id::text)
WHERE item_unique_key IS NULL OR item_unique_key = '';

DROP INDEX IF EXISTS public.jst_aftersale_received_items_unique_key_idx;
CREATE UNIQUE INDEX jst_aftersale_received_items_unique_key_idx
  ON public.jst_aftersale_received_items(item_unique_key);
