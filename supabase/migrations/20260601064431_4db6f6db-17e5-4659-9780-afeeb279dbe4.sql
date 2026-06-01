-- ============================================================
-- Batch 2 (Minimal): Cash Flow Core
-- ============================================================

-- ---------- Enums ----------
DO $$ BEGIN
  CREATE TYPE public.business_entity_type AS ENUM ('individual','company');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.cash_direction AS ENUM ('in','out','transfer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Helper functions ----------
CREATE OR REPLACE FUNCTION public.can_write_finance(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_ops_internal(_uid) AND (
    public.has_ops_role(_uid, 'admin'::public.ops_role_code)
    OR public.has_ops_role(_uid, 'finance'::public.ops_role_code)
  )
$$;

CREATE OR REPLACE FUNCTION public.can_read_finance(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_ops_internal(_uid) AND (
    public.has_ops_role(_uid, 'admin'::public.ops_role_code)
    OR public.has_ops_role(_uid, 'finance'::public.ops_role_code)
  )
$$;

-- ============================================================
-- business_entities
-- ============================================================
CREATE TABLE IF NOT EXISTS public.business_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type public.business_entity_type NOT NULL DEFAULT 'individual',
  name text NOT NULL,
  code text UNIQUE,
  legal_person text,
  registration_no text,
  tax_no text,
  annual_flow_limit numeric(18,2) NOT NULL DEFAULT 5000000,
  status text NOT NULL DEFAULT 'active',
  remark text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_entities TO authenticated;
GRANT ALL ON public.business_entities TO service_role;
ALTER TABLE public.business_entities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance read business_entities" ON public.business_entities;
CREATE POLICY "finance read business_entities" ON public.business_entities
  FOR SELECT TO authenticated USING (public.can_read_finance(auth.uid()) AND deleted_at IS NULL);

DROP POLICY IF EXISTS "finance write business_entities" ON public.business_entities;
CREATE POLICY "finance write business_entities" ON public.business_entities
  FOR ALL TO authenticated
  USING (public.can_write_finance(auth.uid()))
  WITH CHECK (public.can_write_finance(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_business_entities_active ON public.business_entities(status) WHERE deleted_at IS NULL;

-- ============================================================
-- bank_accounts
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL,
  account_name text NOT NULL,
  bank_name text,
  account_no_masked text,
  account_type text DEFAULT 'bank',
  currency text NOT NULL DEFAULT 'CNY',
  current_balance numeric(18,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  remark text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bank_accounts_entity_id_fkey') THEN
    ALTER TABLE public.bank_accounts
      ADD CONSTRAINT bank_accounts_entity_id_fkey
      FOREIGN KEY (entity_id) REFERENCES public.business_entities(id) ON DELETE RESTRICT;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_accounts TO authenticated;
GRANT ALL ON public.bank_accounts TO service_role;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance read bank_accounts" ON public.bank_accounts;
CREATE POLICY "finance read bank_accounts" ON public.bank_accounts
  FOR SELECT TO authenticated USING (public.can_read_finance(auth.uid()) AND deleted_at IS NULL);

DROP POLICY IF EXISTS "finance write bank_accounts" ON public.bank_accounts;
CREATE POLICY "finance write bank_accounts" ON public.bank_accounts
  FOR ALL TO authenticated
  USING (public.can_write_finance(auth.uid()))
  WITH CHECK (public.can_write_finance(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_bank_accounts_entity ON public.bank_accounts(entity_id) WHERE deleted_at IS NULL;

-- ============================================================
-- platforms (dictionary)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.platforms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  remark text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platforms TO authenticated;
GRANT ALL ON public.platforms TO service_role;
ALTER TABLE public.platforms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "internal read platforms" ON public.platforms;
CREATE POLICY "internal read platforms" ON public.platforms
  FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()) AND deleted_at IS NULL);

DROP POLICY IF EXISTS "finance write platforms" ON public.platforms;
CREATE POLICY "finance write platforms" ON public.platforms
  FOR ALL TO authenticated
  USING (public.can_write_finance(auth.uid()))
  WITH CHECK (public.can_write_finance(auth.uid()));

-- ============================================================
-- shops
-- ============================================================
CREATE TABLE IF NOT EXISTS public.shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL,
  platform_id uuid NOT NULL,
  name text NOT NULL,
  code text,
  external_shop_id text,
  status text NOT NULL DEFAULT 'active',
  remark text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='shops_entity_id_fkey') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_entity_id_fkey
      FOREIGN KEY (entity_id) REFERENCES public.business_entities(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='shops_platform_id_fkey') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_platform_id_fkey
      FOREIGN KEY (platform_id) REFERENCES public.platforms(id) ON DELETE RESTRICT;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shops TO authenticated;
GRANT ALL ON public.shops TO service_role;
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "internal read shops" ON public.shops;
CREATE POLICY "internal read shops" ON public.shops
  FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()) AND deleted_at IS NULL);

DROP POLICY IF EXISTS "finance write shops" ON public.shops;
CREATE POLICY "finance write shops" ON public.shops
  FOR ALL TO authenticated
  USING (public.can_write_finance(auth.uid()))
  WITH CHECK (public.can_write_finance(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_shops_entity ON public.shops(entity_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shops_platform ON public.shops(platform_id) WHERE deleted_at IS NULL;

-- ============================================================
-- cash_tx_categories (dictionary)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cash_tx_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  direction public.cash_direction NOT NULL,
  parent_id uuid REFERENCES public.cash_tx_categories(id) ON DELETE RESTRICT,
  sort_order int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  remark text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_tx_categories TO authenticated;
GRANT ALL ON public.cash_tx_categories TO service_role;
ALTER TABLE public.cash_tx_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "internal read cash_tx_categories" ON public.cash_tx_categories;
CREATE POLICY "internal read cash_tx_categories" ON public.cash_tx_categories
  FOR SELECT TO authenticated USING (public.is_ops_internal(auth.uid()) AND deleted_at IS NULL);

DROP POLICY IF EXISTS "finance write cash_tx_categories" ON public.cash_tx_categories;
CREATE POLICY "finance write cash_tx_categories" ON public.cash_tx_categories
  FOR ALL TO authenticated
  USING (public.can_write_finance(auth.uid()))
  WITH CHECK (public.can_write_finance(auth.uid()));

-- ============================================================
-- cash_transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cash_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_no text UNIQUE,
  entity_id uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  direction public.cash_direction NOT NULL,
  amount numeric(18,2) NOT NULL,
  currency text NOT NULL DEFAULT 'CNY',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  category_id uuid,
  shop_id uuid,
  supplier_id uuid,
  supplier_bill_id uuid,
  counterparty text,
  summary text,
  attachment_path text,
  status text NOT NULL DEFAULT 'confirmed',
  operator_id uuid,
  remark text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cash_transactions_entity_id_fkey') THEN
    ALTER TABLE public.cash_transactions ADD CONSTRAINT cash_transactions_entity_id_fkey
      FOREIGN KEY (entity_id) REFERENCES public.business_entities(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cash_transactions_bank_account_id_fkey') THEN
    ALTER TABLE public.cash_transactions ADD CONSTRAINT cash_transactions_bank_account_id_fkey
      FOREIGN KEY (bank_account_id) REFERENCES public.bank_accounts(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cash_transactions_category_id_fkey') THEN
    ALTER TABLE public.cash_transactions ADD CONSTRAINT cash_transactions_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES public.cash_tx_categories(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cash_transactions_shop_id_fkey') THEN
    ALTER TABLE public.cash_transactions ADD CONSTRAINT cash_transactions_shop_id_fkey
      FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cash_transactions_supplier_id_fkey') THEN
    ALTER TABLE public.cash_transactions ADD CONSTRAINT cash_transactions_supplier_id_fkey
      FOREIGN KEY (supplier_id) REFERENCES public.ops_suppliers(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cash_transactions_supplier_bill_id_fkey') THEN
    ALTER TABLE public.cash_transactions ADD CONSTRAINT cash_transactions_supplier_bill_id_fkey
      FOREIGN KEY (supplier_bill_id) REFERENCES public.ops_supplier_bills(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cash_transactions_operator_id_fkey') THEN
    ALTER TABLE public.cash_transactions ADD CONSTRAINT cash_transactions_operator_id_fkey
      FOREIGN KEY (operator_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_transactions TO authenticated;
GRANT ALL ON public.cash_transactions TO service_role;
ALTER TABLE public.cash_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance read cash_transactions" ON public.cash_transactions;
CREATE POLICY "finance read cash_transactions" ON public.cash_transactions
  FOR SELECT TO authenticated USING (public.can_read_finance(auth.uid()) AND deleted_at IS NULL);

DROP POLICY IF EXISTS "finance write cash_transactions" ON public.cash_transactions;
CREATE POLICY "finance write cash_transactions" ON public.cash_transactions
  FOR ALL TO authenticated
  USING (public.can_write_finance(auth.uid()))
  WITH CHECK (public.can_write_finance(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_cash_tx_entity_date ON public.cash_transactions(entity_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cash_tx_bank_date ON public.cash_transactions(bank_account_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cash_tx_shop ON public.cash_transactions(shop_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cash_tx_supplier ON public.cash_transactions(supplier_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cash_tx_supplier_bill ON public.cash_transactions(supplier_bill_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cash_tx_category ON public.cash_transactions(category_id) WHERE deleted_at IS NULL;

-- ============================================================
-- updated_at triggers
-- ============================================================
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['business_entities','bank_accounts','platforms','shops','cash_tx_categories','cash_transactions']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()', t, t);
  END LOOP;
END $$;

-- ============================================================
-- Storage bucket: cash-tx-attachments (private)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('cash-tx-attachments', 'cash-tx-attachments', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "finance read cash-tx-attachments" ON storage.objects;
CREATE POLICY "finance read cash-tx-attachments" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'cash-tx-attachments' AND public.can_read_finance(auth.uid()));

DROP POLICY IF EXISTS "finance write cash-tx-attachments" ON storage.objects;
CREATE POLICY "finance write cash-tx-attachments" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'cash-tx-attachments' AND public.can_write_finance(auth.uid()))
  WITH CHECK (bucket_id = 'cash-tx-attachments' AND public.can_write_finance(auth.uid()));
