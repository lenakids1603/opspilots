
-- 0. extend ops_suppliers with jst_supplier_id
ALTER TABLE public.ops_suppliers
  ADD COLUMN IF NOT EXISTS jst_supplier_id text;
CREATE UNIQUE INDEX IF NOT EXISTS ops_suppliers_jst_supplier_id_key
  ON public.ops_suppliers(jst_supplier_id) WHERE jst_supplier_id IS NOT NULL;

-- 1. purchase_orders
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_po_id text NOT NULL UNIQUE,
  supplier_id uuid REFERENCES public.ops_suppliers(id) ON DELETE SET NULL,
  jst_supplier_id text,
  supplier_name text DEFAULT '',
  po_date timestamptz,
  status text DEFAULT '',
  status_label text DEFAULT '',
  raw_receive_status text DEFAULT '',
  warehouse_status text DEFAULT 'not_received',
  expected_delivery_date timestamptz,
  total_purchase_qty numeric NOT NULL DEFAULT 0,
  total_received_qty numeric NOT NULL DEFAULT 0,
  total_unreceived_qty numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  latest_receipt_at timestamptz,
  remark text DEFAULT '',
  jst_modified_at timestamptz,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON public.purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_po_date ON public.purchase_orders(po_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_warehouse_status ON public.purchase_orders(warehouse_status);

GRANT SELECT ON public.purchase_orders TO authenticated;
GRANT ALL ON public.purchase_orders TO service_role;

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal read all purchase_orders" ON public.purchase_orders
  FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));
CREATE POLICY "supplier read own purchase_orders" ON public.purchase_orders
  FOR SELECT TO authenticated
  USING (supplier_id IS NOT NULL AND supplier_id = public.supplier_id_of(auth.uid()));
CREATE POLICY "internal write purchase_orders" ON public.purchase_orders
  FOR ALL TO authenticated
  USING (public.is_ops_internal(auth.uid()))
  WITH CHECK (public.is_ops_internal(auth.uid()));

-- 2. purchase_order_items
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  external_po_id text NOT NULL,
  external_poi_id text,
  style_no text DEFAULT '',
  sku_no text DEFAULT '',
  product_name text DEFAULT '',
  product_image_url text DEFAULT '',
  properties_value text DEFAULT '',
  color text DEFAULT '',
  size text DEFAULT '',
  spec text DEFAULT '',
  purchase_qty numeric NOT NULL DEFAULT 0,
  received_qty numeric NOT NULL DEFAULT 0,
  unreceived_qty numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  delivery_date timestamptz,
  item_remark text DEFAULT '',
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_items_external_poi_key
  ON public.purchase_order_items(external_poi_id) WHERE external_poi_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_items_fallback_key
  ON public.purchase_order_items(external_po_id, sku_no, style_no) WHERE external_poi_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_poi_po ON public.purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_poi_style ON public.purchase_order_items(style_no);
CREATE INDEX IF NOT EXISTS idx_poi_sku ON public.purchase_order_items(sku_no);

GRANT SELECT ON public.purchase_order_items TO authenticated;
GRANT ALL ON public.purchase_order_items TO service_role;

ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal read all poi" ON public.purchase_order_items
  FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));
CREATE POLICY "supplier read own poi" ON public.purchase_order_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.purchase_orders po
      WHERE po.id = purchase_order_items.purchase_order_id
        AND po.supplier_id IS NOT NULL
        AND po.supplier_id = public.supplier_id_of(auth.uid())
    )
  );
CREATE POLICY "internal write poi" ON public.purchase_order_items
  FOR ALL TO authenticated
  USING (public.is_ops_internal(auth.uid()))
  WITH CHECK (public.is_ops_internal(auth.uid()));

-- 3. purchase_receipts
CREATE TABLE IF NOT EXISTS public.purchase_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_io_id text NOT NULL UNIQUE,
  purchase_order_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  external_po_id text,
  jst_supplier_id text,
  supplier_name text DEFAULT '',
  warehouse_name text DEFAULT '',
  io_date timestamptz,
  status text DEFAULT '',
  jst_modified_at timestamptz,
  remark text DEFAULT '',
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pr_po ON public.purchase_receipts(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_pr_external_po ON public.purchase_receipts(external_po_id);

GRANT SELECT ON public.purchase_receipts TO authenticated;
GRANT ALL ON public.purchase_receipts TO service_role;

ALTER TABLE public.purchase_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal read all pr" ON public.purchase_receipts
  FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));
CREATE POLICY "supplier read own pr" ON public.purchase_receipts
  FOR SELECT TO authenticated USING (
    purchase_order_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.purchase_orders po
      WHERE po.id = purchase_receipts.purchase_order_id
        AND po.supplier_id IS NOT NULL
        AND po.supplier_id = public.supplier_id_of(auth.uid())
    )
  );
CREATE POLICY "internal write pr" ON public.purchase_receipts
  FOR ALL TO authenticated
  USING (public.is_ops_internal(auth.uid()))
  WITH CHECK (public.is_ops_internal(auth.uid()));

-- 4. purchase_receipt_items
CREATE TABLE IF NOT EXISTS public.purchase_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.purchase_receipts(id) ON DELETE CASCADE,
  purchase_order_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  external_io_id text NOT NULL,
  external_ioi_id text,
  external_po_id text,
  sku_no text DEFAULT '',
  product_name text DEFAULT '',
  received_qty numeric NOT NULL DEFAULT 0,
  cost_price numeric NOT NULL DEFAULT 0,
  cost_amount numeric NOT NULL DEFAULT 0,
  remark text DEFAULT '',
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pri_external_ioi_key
  ON public.purchase_receipt_items(external_ioi_id) WHERE external_ioi_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pri_fallback_key
  ON public.purchase_receipt_items(external_io_id, sku_no) WHERE external_ioi_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_pri_receipt ON public.purchase_receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_pri_po ON public.purchase_receipt_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_pri_external_po ON public.purchase_receipt_items(external_po_id);
CREATE INDEX IF NOT EXISTS idx_pri_sku ON public.purchase_receipt_items(sku_no);

GRANT SELECT ON public.purchase_receipt_items TO authenticated;
GRANT ALL ON public.purchase_receipt_items TO service_role;

ALTER TABLE public.purchase_receipt_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal read all pri" ON public.purchase_receipt_items
  FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));
CREATE POLICY "supplier read own pri" ON public.purchase_receipt_items
  FOR SELECT TO authenticated USING (
    purchase_order_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.purchase_orders po
      WHERE po.id = purchase_receipt_items.purchase_order_id
        AND po.supplier_id IS NOT NULL
        AND po.supplier_id = public.supplier_id_of(auth.uid())
    )
  );
CREATE POLICY "internal write pri" ON public.purchase_receipt_items
  FOR ALL TO authenticated
  USING (public.is_ops_internal(auth.uid()))
  WITH CHECK (public.is_ops_internal(auth.uid()));

-- 5. jst_sync_state
CREATE TABLE IF NOT EXISTS public.jst_sync_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.jst_sync_state TO authenticated;
GRANT ALL ON public.jst_sync_state TO service_role;
ALTER TABLE public.jst_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read sync state" ON public.jst_sync_state
  FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));

-- 6. jst_sync_logs
CREATE TABLE IF NOT EXISTS public.jst_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  cursor_from timestamptz,
  cursor_to timestamptz,
  fetched_orders_count int DEFAULT 0,
  fetched_items_count int DEFAULT 0,
  fetched_receipts_count int DEFAULT 0,
  message text DEFAULT '',
  error_detail text DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_jst_logs_started ON public.jst_sync_logs(started_at DESC);
GRANT SELECT ON public.jst_sync_logs TO authenticated;
GRANT ALL ON public.jst_sync_logs TO service_role;
ALTER TABLE public.jst_sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read sync logs" ON public.jst_sync_logs
  FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));

-- 7. jst_tokens
CREATE TABLE IF NOT EXISTS public.jst_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token text NOT NULL,
  refresh_token text DEFAULT '',
  expires_at timestamptz,
  scope text DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.jst_tokens TO service_role;
ALTER TABLE public.jst_tokens ENABLE ROW LEVEL SECURITY;
-- no policies for normal users: only service_role can access

-- 8. updated_at triggers
DROP TRIGGER IF EXISTS trg_po_updated ON public.purchase_orders;
CREATE TRIGGER trg_po_updated BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS trg_poi_updated ON public.purchase_order_items;
CREATE TRIGGER trg_poi_updated BEFORE UPDATE ON public.purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS trg_pr_updated ON public.purchase_receipts;
CREATE TRIGGER trg_pr_updated BEFORE UPDATE ON public.purchase_receipts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS trg_pri_updated ON public.purchase_receipt_items;
CREATE TRIGGER trg_pri_updated BEFORE UPDATE ON public.purchase_receipt_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 9. recalc aggregates function
CREATE OR REPLACE FUNCTION public.recalc_purchase_order_aggregates(_po_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_purchase numeric;
  v_total_amount numeric;
  v_latest_receipt timestamptz;
BEGIN
  -- update each item's received_qty from receipts matched by external_po_id + sku_no
  UPDATE public.purchase_order_items poi
  SET received_qty = COALESCE(r.qty, 0),
      unreceived_qty = GREATEST(poi.purchase_qty - COALESCE(r.qty, 0), 0)
  FROM (
    SELECT pri.external_po_id, pri.sku_no, SUM(pri.received_qty) AS qty
    FROM public.purchase_receipt_items pri
    WHERE pri.purchase_order_id = _po_id
    GROUP BY pri.external_po_id, pri.sku_no
  ) r
  WHERE poi.purchase_order_id = _po_id
    AND poi.external_po_id = r.external_po_id
    AND poi.sku_no = r.sku_no;

  -- items with no receipts → received_qty=0
  UPDATE public.purchase_order_items poi
  SET received_qty = 0,
      unreceived_qty = poi.purchase_qty
  WHERE poi.purchase_order_id = _po_id
    AND NOT EXISTS (
      SELECT 1 FROM public.purchase_receipt_items pri
      WHERE pri.purchase_order_id = _po_id
        AND pri.external_po_id = poi.external_po_id
        AND pri.sku_no = poi.sku_no
    );

  SELECT COALESCE(SUM(purchase_qty),0), COALESCE(SUM(purchase_qty*unit_price),0)
    INTO v_total_purchase, v_total_amount
  FROM public.purchase_order_items WHERE purchase_order_id = _po_id;

  SELECT MAX(io_date) INTO v_latest_receipt
  FROM public.purchase_receipts WHERE purchase_order_id = _po_id;

  UPDATE public.purchase_orders po
  SET total_purchase_qty = v_total_purchase,
      total_received_qty = (SELECT COALESCE(SUM(received_qty),0) FROM public.purchase_order_items WHERE purchase_order_id = _po_id),
      total_unreceived_qty = (SELECT COALESCE(SUM(unreceived_qty),0) FROM public.purchase_order_items WHERE purchase_order_id = _po_id),
      total_amount = v_total_amount,
      latest_receipt_at = v_latest_receipt,
      warehouse_status = CASE
        WHEN (SELECT COALESCE(SUM(received_qty),0) FROM public.purchase_order_items WHERE purchase_order_id = _po_id) <= 0 THEN 'not_received'
        WHEN (SELECT COALESCE(SUM(received_qty),0) FROM public.purchase_order_items WHERE purchase_order_id = _po_id) < v_total_purchase THEN 'partial'
        ELSE 'received'
      END
  WHERE po.id = _po_id;
END;
$$;
