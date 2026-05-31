-- purchase_orders
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_external_po_id_uk
  ON public.purchase_orders (external_po_id);

-- purchase_order_items
CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_items_external_poi_id_uk
  ON public.purchase_order_items (external_poi_id)
  WHERE external_poi_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_items_po_sku_style_uk
  ON public.purchase_order_items (external_po_id, sku_no, style_no);

-- purchase_receipts
CREATE UNIQUE INDEX IF NOT EXISTS purchase_receipts_external_io_id_uk
  ON public.purchase_receipts (external_io_id);

-- purchase_receipt_items
CREATE UNIQUE INDEX IF NOT EXISTS purchase_receipt_items_external_ioi_id_uk
  ON public.purchase_receipt_items (external_ioi_id)
  WHERE external_ioi_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS purchase_receipt_items_io_sku_uk
  ON public.purchase_receipt_items (external_io_id, sku_no);