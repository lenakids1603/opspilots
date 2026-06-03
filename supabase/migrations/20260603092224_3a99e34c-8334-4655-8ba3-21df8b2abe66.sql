CREATE TABLE public.jst_outbound_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  io_id text NOT NULL UNIQUE,
  o_id text,
  so_id text,
  shop_id text,
  shop_name text,
  warehouse text,
  wms_co_id text,
  status text,
  logistics_company text,
  l_id text,
  lc_id text,
  io_date timestamptz,
  consign_time timestamptz,
  modified_at_jst timestamptz,
  qty numeric NOT NULL DEFAULT 0,
  raw_data jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_jst_outbound_orders_io_date ON public.jst_outbound_orders(io_date DESC);
CREATE INDEX idx_jst_outbound_orders_shop ON public.jst_outbound_orders(shop_id);
CREATE INDEX idx_jst_outbound_orders_status ON public.jst_outbound_orders(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jst_outbound_orders TO authenticated;
GRANT ALL ON public.jst_outbound_orders TO service_role;

ALTER TABLE public.jst_outbound_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read jst_outbound_orders" ON public.jst_outbound_orders
  FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));
CREATE POLICY "admin write jst_outbound_orders" ON public.jst_outbound_orders
  FOR ALL TO authenticated
  USING (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code))
  WITH CHECK (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code));

CREATE TABLE public.jst_outbound_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbound_order_id uuid NOT NULL REFERENCES public.jst_outbound_orders(id) ON DELETE CASCADE,
  io_id text NOT NULL,
  oi_id text,
  ioi_id text,
  sku_id text,
  i_id text,
  name text,
  properties_value text,
  color text,
  size text,
  qty numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  pic text,
  raw_data jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uniq_outbound_items_io_ioi ON public.jst_outbound_order_items(io_id, COALESCE(ioi_id, ''), COALESCE(sku_id, ''), COALESCE(oi_id, ''));
CREATE INDEX idx_jst_outbound_items_io_id ON public.jst_outbound_order_items(io_id);
CREATE INDEX idx_jst_outbound_items_sku_id ON public.jst_outbound_order_items(sku_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jst_outbound_order_items TO authenticated;
GRANT ALL ON public.jst_outbound_order_items TO service_role;

ALTER TABLE public.jst_outbound_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read jst_outbound_order_items" ON public.jst_outbound_order_items
  FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));
CREATE POLICY "admin write jst_outbound_order_items" ON public.jst_outbound_order_items
  FOR ALL TO authenticated
  USING (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code))
  WITH CHECK (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code));