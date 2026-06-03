
-- ============ 1. jst_refund_orders ============
CREATE TABLE public.jst_refund_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  as_id text NOT NULL UNIQUE,
  outer_as_id text,
  o_id text,
  so_id text,
  shop_id text,
  shop_name text,
  type text,
  status text,
  shop_status text,
  good_status text,
  refund_amount numeric NOT NULL DEFAULT 0,
  payment_amount numeric NOT NULL DEFAULT 0,
  freight numeric NOT NULL DEFAULT 0,
  question_type text,
  question_reason text,
  remark text,
  warehouse text,
  logistics_company text,
  l_id text,
  as_date timestamptz,
  created_at_jst timestamptz,
  modified_at_jst timestamptz,
  confirm_date timestamptz,
  raw_data jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_jst_refund_orders_modified ON public.jst_refund_orders(modified_at_jst DESC);
CREATE INDEX idx_jst_refund_orders_shop ON public.jst_refund_orders(shop_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jst_refund_orders TO authenticated;
GRANT ALL ON public.jst_refund_orders TO service_role;

ALTER TABLE public.jst_refund_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read jst_refund_orders" ON public.jst_refund_orders
  FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));
CREATE POLICY "admin write jst_refund_orders" ON public.jst_refund_orders
  FOR ALL TO authenticated
  USING (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code))
  WITH CHECK (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code));

CREATE TRIGGER trg_jst_refund_orders_updated
  BEFORE UPDATE ON public.jst_refund_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============ 2. jst_refund_order_items ============
CREATE TABLE public.jst_refund_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_order_id uuid NOT NULL REFERENCES public.jst_refund_orders(id) ON DELETE CASCADE,
  as_id text NOT NULL,
  asi_id text,
  sku_id text,
  name text,
  properties_value text,
  pic text,
  qty numeric NOT NULL DEFAULT 0,
  r_qty numeric NOT NULL DEFAULT 0,
  price numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  type text,
  outer_oi_id text,
  sku_type text,
  supplier_id text,
  supplier_name text,
  batch_no text,
  raw_data jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- 幂等键：asi_id 优先，否则 sku_id + outer_oi_id
CREATE UNIQUE INDEX uq_jst_refund_items_asi ON public.jst_refund_order_items(as_id, asi_id) WHERE asi_id IS NOT NULL;
CREATE UNIQUE INDEX uq_jst_refund_items_sku ON public.jst_refund_order_items(as_id, sku_id, outer_oi_id) WHERE asi_id IS NULL;
CREATE INDEX idx_jst_refund_items_refund ON public.jst_refund_order_items(refund_order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jst_refund_order_items TO authenticated;
GRANT ALL ON public.jst_refund_order_items TO service_role;

ALTER TABLE public.jst_refund_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read jst_refund_order_items" ON public.jst_refund_order_items
  FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));
CREATE POLICY "admin write jst_refund_order_items" ON public.jst_refund_order_items
  FOR ALL TO authenticated
  USING (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code))
  WITH CHECK (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code));

CREATE TRIGGER trg_jst_refund_order_items_updated
  BEFORE UPDATE ON public.jst_refund_order_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============ 3. jst_aftersale_received_orders ============
CREATE TABLE public.jst_aftersale_received_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  as_id text NOT NULL UNIQUE,
  outer_as_id text,
  o_id text,
  so_id text,
  shop_id text,
  shop_name text,
  warehouse text,
  wh_id text,
  wms_co_id text,
  logistics_company text,
  l_id text,
  received_date timestamptz,
  modified_at_jst timestamptz,
  status text,
  raw_data jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_jst_aftersale_recv_modified ON public.jst_aftersale_received_orders(modified_at_jst DESC);
CREATE INDEX idx_jst_aftersale_recv_shop ON public.jst_aftersale_received_orders(shop_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jst_aftersale_received_orders TO authenticated;
GRANT ALL ON public.jst_aftersale_received_orders TO service_role;

ALTER TABLE public.jst_aftersale_received_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read jst_aftersale_received_orders" ON public.jst_aftersale_received_orders
  FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));
CREATE POLICY "admin write jst_aftersale_received_orders" ON public.jst_aftersale_received_orders
  FOR ALL TO authenticated
  USING (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code))
  WITH CHECK (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code));

CREATE TRIGGER trg_jst_aftersale_recv_updated
  BEFORE UPDATE ON public.jst_aftersale_received_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============ 4. jst_aftersale_received_items ============
CREATE TABLE public.jst_aftersale_received_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_order_id uuid NOT NULL REFERENCES public.jst_aftersale_received_orders(id) ON DELETE CASCADE,
  as_id text NOT NULL,
  sku_id text,
  name text,
  properties_value text,
  pic text,
  qty numeric NOT NULL DEFAULT 0,
  r_qty numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  batch_no text,
  supplier_id text,
  supplier_name text,
  raw_data jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_jst_aftersale_recv_items ON public.jst_aftersale_received_items(as_id, sku_id, batch_no);
CREATE INDEX idx_jst_aftersale_recv_items_order ON public.jst_aftersale_received_items(received_order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jst_aftersale_received_items TO authenticated;
GRANT ALL ON public.jst_aftersale_received_items TO service_role;

ALTER TABLE public.jst_aftersale_received_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read jst_aftersale_received_items" ON public.jst_aftersale_received_items
  FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));
CREATE POLICY "admin write jst_aftersale_received_items" ON public.jst_aftersale_received_items
  FOR ALL TO authenticated
  USING (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code))
  WITH CHECK (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code));

CREATE TRIGGER trg_jst_aftersale_recv_items_updated
  BEFORE UPDATE ON public.jst_aftersale_received_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
