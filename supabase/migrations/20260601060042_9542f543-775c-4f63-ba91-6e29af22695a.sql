
-- Enums
CREATE TYPE public.app_role AS ENUM ('employee', 'manager', 'finance');
CREATE TYPE public.expense_status AS ENUM ('draft', 'submitted', 'manager_approved', 'approved', 'rejected', 'reimbursed');
CREATE TYPE public.approval_level AS ENUM ('manager', 'finance');

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT 'General',
  manager_id UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE(user_id, role)
);

CREATE TABLE public.expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT ''
);

CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  merchant TEXT DEFAULT '',
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category_id UUID REFERENCES public.expense_categories(id),
  cost_center TEXT DEFAULT '',
  status expense_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.expense_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.approval_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  approver_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL CHECK (action IN ('approved', 'rejected')),
  comments TEXT DEFAULT '',
  level approval_level NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GRANTs for base tables
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
GRANT SELECT ON public.expense_categories TO authenticated;
GRANT ALL ON public.expense_categories TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_receipts TO authenticated;
GRANT ALL ON public.expense_receipts TO service_role;
GRANT SELECT, INSERT ON public.approval_actions TO authenticated;
GRANT ALL ON public.approval_actions TO service_role;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_manager_of(_manager_id UUID, _employee_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _employee_id AND manager_id = _manager_id)
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, department)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), COALESCE(NEW.raw_user_meta_data->>'department', 'General'));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'employee');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "Managers can view managed profiles" ON public.profiles FOR SELECT TO authenticated USING (manager_id = auth.uid());
CREATE POLICY "Finance can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'finance'));

CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Anyone authenticated can view categories" ON public.expense_categories FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can CRUD own expenses" ON public.expenses FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Managers can view team expenses" ON public.expenses FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'manager') AND public.is_manager_of(auth.uid(), user_id));
CREATE POLICY "Finance can view all expenses" ON public.expenses FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'finance'));
CREATE POLICY "Finance can update all expenses" ON public.expenses FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'finance'));

CREATE POLICY "Users can manage own receipts" ON public.expense_receipts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.expenses WHERE id = expense_id AND user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.expenses WHERE id = expense_id AND user_id = auth.uid()));
CREATE POLICY "Managers can view team receipts" ON public.expense_receipts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = expense_id AND public.has_role(auth.uid(), 'manager') AND public.is_manager_of(auth.uid(), e.user_id)));
CREATE POLICY "Finance can view all receipts" ON public.expense_receipts FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'finance'));

CREATE POLICY "Users can view approvals on own expenses" ON public.approval_actions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.expenses WHERE id = expense_id AND user_id = auth.uid()));
CREATE POLICY "Approvers can view own actions" ON public.approval_actions FOR SELECT TO authenticated USING (approver_id = auth.uid());
CREATE POLICY "Finance can view all approvals" ON public.approval_actions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'finance'));

CREATE POLICY "Users can view own audit logs" ON public.audit_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.expenses WHERE id = expense_id AND user_id = auth.uid()));
CREATE POLICY "Finance can view all audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'finance'));
CREATE POLICY "System can insert audit logs" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', false);

CREATE POLICY "Users can upload own receipts" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users can view own receipts" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Finance can view all storage receipts" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'receipts' AND public.has_role(auth.uid(), 'finance'));

CREATE POLICY "No user insert on roles" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "No user update on roles" ON public.user_roles FOR UPDATE TO authenticated USING (false);
CREATE POLICY "No user delete on roles" ON public.user_roles FOR DELETE TO authenticated USING (false);

CREATE POLICY "No update on approvals" ON public.approval_actions FOR UPDATE TO authenticated USING (false);
CREATE POLICY "No delete on approvals" ON public.approval_actions FOR DELETE TO authenticated USING (false);

CREATE POLICY "Only finance can insert categories" ON public.expense_categories FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'finance'));
CREATE POLICY "Only finance can update categories" ON public.expense_categories FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'finance'));
CREATE POLICY "Only finance can delete categories" ON public.expense_categories FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'finance'));

CREATE POLICY "No update on audit logs" ON public.audit_logs FOR UPDATE TO authenticated USING (false);
CREATE POLICY "No delete on audit logs" ON public.audit_logs FOR DELETE TO authenticated USING (false);

CREATE POLICY "Only finance can insert approvals" ON public.approval_actions
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'finance'::app_role));

-- user_type + profiles extension
CREATE TYPE public.user_type AS ENUM ('internal', 'supplier');
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS phone TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS user_type public.user_type NOT NULL DEFAULT 'internal';

CREATE OR REPLACE FUNCTION public.get_email_by_identifier(_identifier TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.email FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.email = lower(_identifier) OR p.username = _identifier OR p.phone = _identifier OR u.phone = _identifier
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_email_by_identifier(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, department, username, phone, user_type)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'department', 'General'),
    NULLIF(NEW.raw_user_meta_data->>'username', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE((NEW.raw_user_meta_data->>'user_type')::public.user_type, 'internal'));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'employee');
  RETURN NEW;
END;
$$;

-- ============ OpsPilot Phase 1 schema ============
CREATE TYPE public.ops_account_type AS ENUM ('internal', 'supplier');
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_type public.ops_account_type NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS supplier_id uuid;

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
CREATE POLICY "supplier sees own record" ON public.ops_suppliers FOR SELECT TO authenticated USING (id = public.supplier_id_of(auth.uid()));

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

CREATE TRIGGER ops_suppliers_updated BEFORE UPDATE ON public.ops_suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER ops_products_updated BEFORE UPDATE ON public.ops_products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER ops_skus_updated BEFORE UPDATE ON public.ops_skus FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER ops_arrivals_updated BEFORE UPDATE ON public.ops_arrivals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER ops_bills_updated BEFORE UPDATE ON public.ops_supplier_bills FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- prevent_profile_privilege_change
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_is_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  v_is_admin := public.has_ops_role(auth.uid(), 'admin');
  IF NOT v_is_admin THEN
    IF NEW.account_type IS DISTINCT FROM OLD.account_type
       OR NEW.user_type   IS DISTINCT FROM OLD.user_type
       OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
       OR NEW.manager_id  IS DISTINCT FROM OLD.manager_id
       OR NEW.id          IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Not allowed to modify protected profile fields';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_prevent_priv_change BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_privilege_change();

-- Tighten storage policy
DROP POLICY IF EXISTS "Managers can view team receipts" ON storage.objects;
CREATE POLICY "Managers can view team receipts" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'receipts' AND public.has_role(auth.uid(), 'manager'::public.app_role)
  AND EXISTS (
    SELECT 1 FROM public.expense_receipts r
    JOIN public.expenses e ON e.id = r.expense_id
    WHERE r.file_path = storage.objects.name AND public.is_manager_of(auth.uid(), e.user_id)
  )
);

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_manager_of(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_ops_role(uuid, public.ops_role_code) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_ops_internal(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.supplier_id_of(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_privilege_change() FROM PUBLIC, anon, authenticated;

-- JST purchase orders
ALTER TABLE public.ops_suppliers ADD COLUMN IF NOT EXISTS jst_supplier_id text;
CREATE UNIQUE INDEX IF NOT EXISTS ops_suppliers_jst_supplier_id_key
  ON public.ops_suppliers(jst_supplier_id) WHERE jst_supplier_id IS NOT NULL;

CREATE TABLE public.purchase_orders (
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
CREATE INDEX idx_purchase_orders_supplier ON public.purchase_orders(supplier_id);
CREATE INDEX idx_purchase_orders_po_date ON public.purchase_orders(po_date DESC);
CREATE INDEX idx_purchase_orders_warehouse_status ON public.purchase_orders(warehouse_status);
GRANT SELECT ON public.purchase_orders TO authenticated;
GRANT ALL ON public.purchase_orders TO service_role;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read all purchase_orders" ON public.purchase_orders FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));
CREATE POLICY "supplier read own purchase_orders" ON public.purchase_orders FOR SELECT TO authenticated USING (supplier_id IS NOT NULL AND supplier_id = public.supplier_id_of(auth.uid()));
CREATE POLICY "internal write purchase_orders" ON public.purchase_orders FOR ALL TO authenticated USING (public.is_ops_internal(auth.uid())) WITH CHECK (public.is_ops_internal(auth.uid()));

CREATE TABLE public.purchase_order_items (
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
CREATE INDEX idx_poi_po ON public.purchase_order_items(purchase_order_id);
CREATE INDEX idx_poi_style ON public.purchase_order_items(style_no);
CREATE INDEX idx_poi_sku ON public.purchase_order_items(sku_no);
GRANT SELECT ON public.purchase_order_items TO authenticated;
GRANT ALL ON public.purchase_order_items TO service_role;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read all poi" ON public.purchase_order_items FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));
CREATE POLICY "supplier read own poi" ON public.purchase_order_items FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = purchase_order_items.purchase_order_id AND po.supplier_id IS NOT NULL AND po.supplier_id = public.supplier_id_of(auth.uid()))
);
CREATE POLICY "internal write poi" ON public.purchase_order_items FOR ALL TO authenticated USING (public.is_ops_internal(auth.uid())) WITH CHECK (public.is_ops_internal(auth.uid()));

CREATE TABLE public.purchase_receipts (
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
CREATE INDEX idx_pr_po ON public.purchase_receipts(purchase_order_id);
CREATE INDEX idx_pr_external_po ON public.purchase_receipts(external_po_id);
GRANT SELECT ON public.purchase_receipts TO authenticated;
GRANT ALL ON public.purchase_receipts TO service_role;
ALTER TABLE public.purchase_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read all pr" ON public.purchase_receipts FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));
CREATE POLICY "supplier read own pr" ON public.purchase_receipts FOR SELECT TO authenticated USING (
  purchase_order_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = purchase_receipts.purchase_order_id AND po.supplier_id IS NOT NULL AND po.supplier_id = public.supplier_id_of(auth.uid()))
);
CREATE POLICY "internal write pr" ON public.purchase_receipts FOR ALL TO authenticated USING (public.is_ops_internal(auth.uid())) WITH CHECK (public.is_ops_internal(auth.uid()));

CREATE TABLE public.purchase_receipt_items (
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
CREATE INDEX idx_pri_receipt ON public.purchase_receipt_items(receipt_id);
CREATE INDEX idx_pri_po ON public.purchase_receipt_items(purchase_order_id);
CREATE INDEX idx_pri_external_po ON public.purchase_receipt_items(external_po_id);
CREATE INDEX idx_pri_sku ON public.purchase_receipt_items(sku_no);
GRANT SELECT ON public.purchase_receipt_items TO authenticated;
GRANT ALL ON public.purchase_receipt_items TO service_role;
ALTER TABLE public.purchase_receipt_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read all pri" ON public.purchase_receipt_items FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));
CREATE POLICY "supplier read own pri" ON public.purchase_receipt_items FOR SELECT TO authenticated USING (
  purchase_order_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = purchase_receipt_items.purchase_order_id AND po.supplier_id IS NOT NULL AND po.supplier_id = public.supplier_id_of(auth.uid()))
);
CREATE POLICY "internal write pri" ON public.purchase_receipt_items FOR ALL TO authenticated USING (public.is_ops_internal(auth.uid())) WITH CHECK (public.is_ops_internal(auth.uid()));

CREATE TABLE public.jst_sync_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.jst_sync_state TO authenticated;
GRANT ALL ON public.jst_sync_state TO service_role;
ALTER TABLE public.jst_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read sync state" ON public.jst_sync_state FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));

CREATE TABLE public.jst_sync_logs (
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
CREATE INDEX idx_jst_logs_started ON public.jst_sync_logs(started_at DESC);
GRANT SELECT ON public.jst_sync_logs TO authenticated;
GRANT ALL ON public.jst_sync_logs TO service_role;
ALTER TABLE public.jst_sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read sync logs" ON public.jst_sync_logs FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()));

CREATE TABLE public.jst_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token text NOT NULL,
  refresh_token text DEFAULT '',
  expires_at timestamptz,
  scope text DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.jst_tokens TO service_role;
ALTER TABLE public.jst_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jst_tokens FROM anon, authenticated;

CREATE TRIGGER trg_po_updated BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_poi_updated BEFORE UPDATE ON public.purchase_order_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_pr_updated BEFORE UPDATE ON public.purchase_receipts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_pri_updated BEFORE UPDATE ON public.purchase_receipt_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.recalc_purchase_order_aggregates(_po_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total_purchase numeric; v_total_amount numeric; v_latest_receipt timestamptz;
BEGIN
  UPDATE public.purchase_order_items poi
  SET received_qty = COALESCE(r.qty, 0),
      unreceived_qty = GREATEST(poi.purchase_qty - COALESCE(r.qty, 0), 0)
  FROM (
    SELECT pri.external_po_id, pri.sku_no, SUM(pri.received_qty) AS qty
    FROM public.purchase_receipt_items pri
    WHERE pri.purchase_order_id = _po_id
    GROUP BY pri.external_po_id, pri.sku_no
  ) r
  WHERE poi.purchase_order_id = _po_id AND poi.external_po_id = r.external_po_id AND poi.sku_no = r.sku_no;

  UPDATE public.purchase_order_items poi
  SET received_qty = 0, unreceived_qty = poi.purchase_qty
  WHERE poi.purchase_order_id = _po_id
    AND NOT EXISTS (SELECT 1 FROM public.purchase_receipt_items pri WHERE pri.purchase_order_id = _po_id AND pri.external_po_id = poi.external_po_id AND pri.sku_no = poi.sku_no);

  SELECT COALESCE(SUM(purchase_qty),0), COALESCE(SUM(purchase_qty*unit_price),0) INTO v_total_purchase, v_total_amount
  FROM public.purchase_order_items WHERE purchase_order_id = _po_id;
  SELECT MAX(io_date) INTO v_latest_receipt FROM public.purchase_receipts WHERE purchase_order_id = _po_id;

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

REVOKE ALL ON FUNCTION public.recalc_purchase_order_aggregates(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_purchase_order_aggregates(uuid) TO service_role;

-- Unique indexes for items
CREATE UNIQUE INDEX purchase_order_items_external_poi_id_uk ON public.purchase_order_items (external_poi_id);
CREATE UNIQUE INDEX purchase_order_items_po_sku_style_uk ON public.purchase_order_items (external_po_id, sku_no, style_no);
CREATE UNIQUE INDEX purchase_receipt_items_external_ioi_id_uk ON public.purchase_receipt_items (external_ioi_id);
CREATE UNIQUE INDEX purchase_receipt_items_io_sku_uk ON public.purchase_receipt_items (external_io_id, sku_no);

-- ops_products + ops_skus extension
ALTER TABLE public.ops_products
  ADD COLUMN IF NOT EXISTS jst_product_id text,
  ADD COLUMN IF NOT EXISTS style_no text,
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS supplier_name_snapshot text,
  ADD COLUMN IF NOT EXISTS season text,
  ADD COLUMN IF NOT EXISTS year int,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS age_range text,
  ADD COLUMN IF NOT EXISTS main_image_url text,
  ADD COLUMN IF NOT EXISTS external_image_url text,
  ADD COLUMN IF NOT EXISTS image_storage_path text,
  ADD COLUMN IF NOT EXISTS cost_price numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sale_price numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS raw_jst_json jsonb,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
CREATE UNIQUE INDEX ops_products_jst_id_uk ON public.ops_products(jst_product_id) WHERE jst_product_id IS NOT NULL;
CREATE INDEX ops_products_style_no_idx ON public.ops_products(style_no);

ALTER TABLE public.ops_skus
  ADD COLUMN IF NOT EXISTS jst_sku_id text,
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS size text,
  ADD COLUMN IF NOT EXISTS spec_name text,
  ADD COLUMN IF NOT EXISTS sku_name text,
  ADD COLUMN IF NOT EXISTS supplier_id uuid,
  ADD COLUMN IF NOT EXISTS sku_image_url text,
  ADD COLUMN IF NOT EXISTS external_image_url text,
  ADD COLUMN IF NOT EXISTS image_storage_path text,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS raw_jst_json jsonb,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
CREATE UNIQUE INDEX ops_skus_jst_id_uk ON public.ops_skus(jst_sku_id) WHERE jst_sku_id IS NOT NULL;

CREATE TABLE public.ops_sku_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id uuid REFERENCES public.ops_skus(id) ON DELETE CASCADE,
  platform text,
  shop_id text,
  external_product_id text,
  external_sku_id text,
  external_sku_code text,
  barcode text,
  jst_sku_id text,
  alias_type text NOT NULL,
  is_primary boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_sku_aliases TO authenticated;
GRANT ALL ON public.ops_sku_aliases TO service_role;
ALTER TABLE public.ops_sku_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal full aliases" ON public.ops_sku_aliases FOR ALL TO authenticated USING (is_ops_internal(auth.uid())) WITH CHECK (is_ops_internal(auth.uid()));
CREATE UNIQUE INDEX ops_sku_aliases_uk ON public.ops_sku_aliases(alias_type, external_sku_code) WHERE external_sku_code IS NOT NULL;
CREATE INDEX ops_sku_aliases_sku_idx ON public.ops_sku_aliases(sku_id);

INSERT INTO storage.buckets (id, name, public) VALUES ('product-images','product-images', true) ON CONFLICT (id) DO NOTHING;
CREATE POLICY "product-images public read" ON storage.objects FOR SELECT USING (bucket_id = 'product-images');
CREATE POLICY "product-images internal write" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'product-images' AND is_ops_internal(auth.uid()));
CREATE POLICY "product-images internal update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'product-images' AND is_ops_internal(auth.uid()));
CREATE POLICY "product-images internal delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'product-images' AND is_ops_internal(auth.uid()));

CREATE OR REPLACE VIEW public.v_purchase_order_items_with_image AS
SELECT poi.*,
  COALESCE(NULLIF(s.sku_image_url, ''), NULLIF(p.main_image_url, ''), NULLIF(s.external_image_url, ''), NULLIF(p.external_image_url, ''), NULLIF(poi.product_image_url, '')) AS resolved_image_url,
  s.color AS sku_color, s.size AS sku_size,
  p.style_no AS resolved_style_no, p.product_name AS resolved_product_name
FROM public.purchase_order_items poi
LEFT JOIN public.ops_skus s ON s.sku_code = poi.sku_no
LEFT JOIN public.ops_products p ON p.id = s.product_id;

GRANT SELECT ON public.v_purchase_order_items_with_image TO authenticated;
GRANT SELECT ON public.v_purchase_order_items_with_image TO service_role;
