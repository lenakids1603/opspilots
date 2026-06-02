-- 1. Extend bank_accounts
ALTER TABLE public.bank_accounts
  ADD COLUMN IF NOT EXISTS account_holder_name text,
  ADD COLUMN IF NOT EXISTS owner_entity_id uuid REFERENCES public.business_entities(id),
  ADD COLUMN IF NOT EXISTS related_entity_id uuid REFERENCES public.business_entities(id),
  ADD COLUMN IF NOT EXISTS related_person_name text,
  ADD COLUMN IF NOT EXISTS account_number text,
  ADD COLUMN IF NOT EXISTS usage_type text;

-- Relax legacy NOT NULL
ALTER TABLE public.bank_accounts ALTER COLUMN entity_id DROP NOT NULL;

-- Backfill from existing data
UPDATE public.bank_accounts ba
SET owner_entity_id = COALESCE(ba.owner_entity_id, ba.entity_id),
    account_holder_name = COALESCE(NULLIF(ba.account_holder_name,''), be.name, ba.account_name),
    account_number = COALESCE(NULLIF(ba.account_number,''), ba.normalized_account_no, ba.account_no_masked)
FROM public.business_entities be
WHERE be.id = ba.entity_id;

UPDATE public.bank_accounts
SET account_holder_name = COALESCE(NULLIF(account_holder_name,''), account_name, '');

UPDATE public.bank_accounts
SET usage_type = CASE
  WHEN purpose IN ('收款','collection') THEN 'collection'
  WHEN purpose IN ('付款','payment') THEN 'payment'
  WHEN purpose IN ('投流','ads') THEN 'ads'
  WHEN purpose IN ('运营服务费','operation_fee') THEN 'operation_fee'
  WHEN purpose IN ('备用','backup') THEN 'backup'
  ELSE 'other'
END
WHERE usage_type IS NULL;

UPDATE public.bank_accounts
SET account_type = CASE WHEN account_type IN ('corporate','personal') THEN account_type ELSE 'corporate' END;

-- Defaults + constraints
ALTER TABLE public.bank_accounts
  ALTER COLUMN account_type SET DEFAULT 'corporate',
  ALTER COLUMN usage_type SET DEFAULT 'other',
  ALTER COLUMN account_holder_name SET DEFAULT '';

ALTER TABLE public.bank_accounts
  ADD CONSTRAINT bank_accounts_account_type_chk CHECK (account_type IN ('corporate','personal')),
  ADD CONSTRAINT bank_accounts_usage_type_chk CHECK (usage_type IN ('collection','payment','ads','operation_fee','backup','other'));

-- 2. shop_bank_account_bindings
CREATE TABLE public.shop_bank_account_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  platform_id uuid REFERENCES public.platforms(id),
  binding_type text NOT NULL DEFAULT 'collection' CHECK (binding_type IN ('collection','payment','ads','backup','other')),
  is_default boolean NOT NULL DEFAULT false,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  remark text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, bank_account_id, binding_type, effective_from)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_bank_account_bindings TO authenticated;
GRANT ALL ON public.shop_bank_account_bindings TO service_role;

ALTER TABLE public.shop_bank_account_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal read shop_bank_account_bindings"
  ON public.shop_bank_account_bindings FOR SELECT TO authenticated
  USING (public.is_ops_internal(auth.uid()));

CREATE POLICY "finance write shop_bank_account_bindings"
  ON public.shop_bank_account_bindings FOR ALL TO authenticated
  USING (public.can_write_finance(auth.uid()))
  WITH CHECK (public.can_write_finance(auth.uid()));

CREATE TRIGGER trg_sbab_updated_at
  BEFORE UPDATE ON public.shop_bank_account_bindings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX idx_sbab_shop ON public.shop_bank_account_bindings(shop_id);
CREATE INDEX idx_sbab_bank ON public.shop_bank_account_bindings(bank_account_id);

CREATE UNIQUE INDEX uniq_default_per_shop_binding
  ON public.shop_bank_account_bindings(shop_id, binding_type)
  WHERE is_default = true AND status = 'active';