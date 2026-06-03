-- 删除入库明细（按入库单时间）
DELETE FROM public.purchase_receipt_items
WHERE receipt_id IN (SELECT id FROM public.purchase_receipts WHERE io_date < '2026-05-01');

-- 删除入库单
DELETE FROM public.purchase_receipts WHERE io_date < '2026-05-01';

-- 删除采购明细（按采购单时间）
DELETE FROM public.purchase_order_items
WHERE purchase_order_id IN (SELECT id FROM public.purchase_orders WHERE po_date < '2026-05-01');

-- 删除采购单
DELETE FROM public.purchase_orders WHERE po_date < '2026-05-01';
