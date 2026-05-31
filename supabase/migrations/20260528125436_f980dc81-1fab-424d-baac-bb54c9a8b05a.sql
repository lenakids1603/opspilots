
-- ============ OpsPilot Phase 1 schema ============

-- Extend profiles with account_type + supplier link
CREATE TYPE public.ops_account_type AS ENUM ('internal', 'supplier');
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_type public.ops_account_type NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS supplier_id uuid;

-- 1) Roles catalog
CREATE TYPE public.ops_role_code AS ENUM ('admin','ops','finance','warehouse','supplier');

CREATE TABLE public.ops_roles (
  code public.ops_role_code PRIMARY KEY,
  name text NOT NULL,
  description text DEFAULT ''
);
GRANT SELECT ON public.ops_roles TO authenticated;
GRANT ALL ON public.ops_roles TO service_role;
ALTER TABLE public.ops_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ops_roles readable" ON public.ops_roles FOR SELECT TO authenticated USING (true);

INSERT INTO public.ops_roles(code,name,description) VALUES
  ('admin','系统管理员','全部权限'),
  ('ops','运营','日常业务'),
  ('finance','财务','账单与对账'),
  ('warehouse','仓库','到货登记'),
  ('supplier','供应商','只看自己');

-- 2) Per-user role mapping (ops scope)
CREATE TABLE public.ops_user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role_code public.ops_role_code NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role_code)
);
GRANT SELECT ON public.ops_user_roles TO authenticated;
GRANT ALL ON public.ops_user_roles TO service_role;
ALTER TABLE public.ops_user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "see own ops roles" ON public.ops_user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

-- security definer helper
CREATE OR REPLACE FUNCTION public.has_ops_role(_uid uuid, _code public.ops_role_code)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.ops_user_roles WHERE user_id = _uid AND role_code = _code)
$$;

CREATE OR REPLACE FUNCTION public.is_ops_internal(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = _uid AND account_type = 'internal')
$$;

CREATE OR REPLACE FUNCTION public.supplier_id_of(_uid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT supplier_id FROM public.profiles WHERE id = _uid
$$;

-- 3) Suppliers
CREATE TABLE public.ops_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  contact text DEFAULT '',
  phone text DEFAULT '',
  email text DEFAULT '',
  address text DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  owner_user_id uuid,
  remark text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_suppliers TO authenticated;
GRANT ALL ON public.ops_suppliers TO service_role;
ALTER TABLE public.ops_suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal can read suppliers" ON public.ops_suppliers FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));
CREATE POLICY "internal can write suppliers" ON public.ops_suppliers FOR ALL TO authenticated USING (public.is_ops_internal(auth.uid())) WITH CHECK (public.is_ops_internal(auth.uid()));
CREATE POLICY "supplier sees own record" ON public.ops_suppliers FOR SELECT TO authenticated USING (id = public.supplier_id_of(auth.uid()));

-- 4) Products
CREATE TABLE public.ops_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  category text DEFAULT '',
  brand text DEFAULT '',
  supplier_id uuid,
  status text NOT NULL DEFAULT 'active',
  remark text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_products TO authenticated;
GRANT ALL ON public.ops_products TO service_role;
ALTER TABLE public.ops_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal full products" ON public.ops_products FOR ALL TO authenticated USING (public.is_ops_internal(auth.uid())) WITH CHECK (public.is_ops_internal(auth.uid()));
CREATE POLICY "supplier reads own products" ON public.ops_products FOR SELECT TO authenticated USING (supplier_id = public.supplier_id_of(auth.uid()));

-- 5) SKUs
CREATE TABLE public.ops_skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.ops_products(id) ON DELETE CASCADE,
  sku_code text NOT NULL UNIQUE,
  spec text DEFAULT '',
  barcode text DEFAULT '',
  cost_price numeric(12,2) DEFAULT 0,
  sale_price numeric(12,2) DEFAULT 0,
  stock integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_skus TO authenticated;
GRANT ALL ON public.ops_skus TO service_role;
ALTER TABLE public.ops_skus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal full skus" ON public.ops_skus FOR ALL TO authenticated USING (public.is_ops_internal(auth.uid())) WITH CHECK (public.is_ops_internal(auth.uid()));
CREATE POLICY "supplier reads own skus" ON public.ops_skus FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.ops_products p WHERE p.id = ops_skus.product_id AND p.supplier_id = public.supplier_id_of(auth.uid()))
);

-- 6) Arrivals
CREATE TABLE public.ops_arrivals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arrival_no text NOT NULL UNIQUE,
  supplier_id uuid NOT NULL,
  arrived_at date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'draft',
  operator_id uuid,
  remark text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_arrivals TO authenticated;
GRANT ALL ON public.ops_arrivals TO service_role;
ALTER TABLE public.ops_arrivals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal full arrivals" ON public.ops_arrivals FOR ALL TO authenticated USING (public.is_ops_internal(auth.uid())) WITH CHECK (public.is_ops_internal(auth.uid()));
CREATE POLICY "supplier reads own arrivals" ON public.ops_arrivals FOR SELECT TO authenticated USING (supplier_id = public.supplier_id_of(auth.uid()));

CREATE TABLE public.ops_arrival_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arrival_id uuid NOT NULL REFERENCES public.ops_arrivals(id) ON DELETE CASCADE,
  sku_id uuid NOT NULL,
  qty_expected integer NOT NULL DEFAULT 0,
  qty_received integer NOT NULL DEFAULT 0,
  unit_price numeric(12,2) DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_arrival_items TO authenticated;
GRANT ALL ON public.ops_arrival_items TO service_role;
ALTER TABLE public.ops_arrival_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal full arrival items" ON public.ops_arrival_items FOR ALL TO authenticated USING (public.is_ops_internal(auth.uid())) WITH CHECK (public.is_ops_internal(auth.uid()));
CREATE POLICY "supplier reads own arrival items" ON public.ops_arrival_items FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.ops_arrivals a WHERE a.id = ops_arrival_items.arrival_id AND a.supplier_id = public.supplier_id_of(auth.uid()))
);

-- 7) Supplier bills
CREATE TABLE public.ops_supplier_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no text NOT NULL UNIQUE,
  supplier_id uuid NOT NULL,
  period text NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  auditor_id uuid,
  audited_at timestamptz,
  remark text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_supplier_bills TO authenticated;
GRANT ALL ON public.ops_supplier_bills TO service_role;
ALTER TABLE public.ops_supplier_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal full bills" ON public.ops_supplier_bills FOR ALL TO authenticated USING (public.is_ops_internal(auth.uid())) WITH CHECK (public.is_ops_internal(auth.uid()));
CREATE POLICY "supplier reads own bills" ON public.ops_supplier_bills FOR SELECT TO authenticated USING (supplier_id = public.supplier_id_of(auth.uid()));

-- updated_at triggers
CREATE TRIGGER ops_suppliers_updated BEFORE UPDATE ON public.ops_suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER ops_products_updated BEFORE UPDATE ON public.ops_products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER ops_skus_updated BEFORE UPDATE ON public.ops_skus FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER ops_arrivals_updated BEFORE UPDATE ON public.ops_arrivals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER ops_bills_updated BEFORE UPDATE ON public.ops_supplier_bills FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Seed test data: link lena (internal admin) and gys (supplier)
DO $$
DECLARE
  v_lena uuid;
  v_gys uuid;
  v_supplier uuid;
BEGIN
  SELECT id INTO v_lena FROM auth.users WHERE email='lena@expensedesk.local' LIMIT 1;
  SELECT id INTO v_gys  FROM auth.users WHERE email='gys@expensedesk.local'  LIMIT 1;

  -- demo supplier for gys
  INSERT INTO public.ops_suppliers(code,name,contact,phone,status,owner_user_id)
  VALUES ('S0001','广源食品有限公司','顾经理','13800000001','active', v_gys)
  ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name
  RETURNING id INTO v_supplier;

  IF v_lena IS NOT NULL THEN
    UPDATE public.profiles SET account_type='internal' WHERE id = v_lena;
    INSERT INTO public.ops_user_roles(user_id, role_code) VALUES (v_lena,'admin')
      ON CONFLICT DO NOTHING;
  END IF;

  IF v_gys IS NOT NULL THEN
    UPDATE public.profiles SET account_type='supplier', supplier_id = v_supplier WHERE id = v_gys;
    INSERT INTO public.ops_user_roles(user_id, role_code) VALUES (v_gys,'supplier')
      ON CONFLICT DO NOTHING;
  END IF;
END $$;
