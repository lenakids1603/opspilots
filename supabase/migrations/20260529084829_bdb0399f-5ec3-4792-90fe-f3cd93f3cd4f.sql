DROP INDEX IF EXISTS public.purchase_order_items_external_poi_id_uk;
CREATE UNIQUE INDEX purchase_order_items_external_poi_id_uk
  ON public.purchase_order_items (external_poi_id);

DROP INDEX IF EXISTS public.purchase_receipt_items_external_ioi_id_uk;
CREATE UNIQUE INDEX purchase_receipt_items_external_ioi_id_uk
  ON public.purchase_receipt_items (external_ioi_id);