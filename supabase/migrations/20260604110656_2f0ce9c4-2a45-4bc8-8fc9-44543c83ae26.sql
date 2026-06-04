
-- Aftersale received: support io_id and unique-key based upserts
ALTER TABLE public.jst_aftersale_received_orders
  ADD COLUMN IF NOT EXISTS io_id text,
  ADD COLUMN IF NOT EXISTS received_unique_key text;

-- Make as_id nullable since some aftersale rows only carry io_id
ALTER TABLE public.jst_aftersale_received_orders ALTER COLUMN as_id DROP NOT NULL;

-- Backfill received_unique_key for existing rows
UPDATE public.jst_aftersale_received_orders
SET received_unique_key = COALESCE(NULLIF(io_id,''), NULLIF(as_id,''), NULLIF(outer_as_id,''))
WHERE received_unique_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS jst_aftersale_received_orders_unique_key_idx
  ON public.jst_aftersale_received_orders(received_unique_key)
  WHERE received_unique_key IS NOT NULL;

ALTER TABLE public.jst_aftersale_received_items
  ADD COLUMN IF NOT EXISTS item_unique_key text;

-- Backfill item_unique_key for existing rows
UPDATE public.jst_aftersale_received_items
SET item_unique_key = concat_ws('|', COALESCE(as_id,''), '', '', COALESCE(sku_id,''), COALESCE(batch_no,''), '')
WHERE item_unique_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS jst_aftersale_received_items_unique_key_idx
  ON public.jst_aftersale_received_items(item_unique_key)
  WHERE item_unique_key IS NOT NULL;
