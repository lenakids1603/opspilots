
-- 1) 清理 bank_accounts 重复（按 normalized account_no 保留最早一条）
WITH ranked AS (
  SELECT id, regexp_replace(coalesce(account_no_masked,''),'\s','','g') AS norm,
    ROW_NUMBER() OVER (PARTITION BY regexp_replace(coalesce(account_no_masked,''),'\s','','g')
                       ORDER BY created_at ASC, id ASC) AS rn
  FROM public.bank_accounts WHERE deleted_at IS NULL AND coalesce(account_no_masked,'') <> ''
)
DELETE FROM public.bank_accounts WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2) business_entities 规范化字段 + 唯一约束
ALTER TABLE public.business_entities
  ADD COLUMN IF NOT EXISTS normalized_name text
    GENERATED ALWAYS AS (lower(btrim(coalesce(name,'')))) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_business_entities_code
  ON public.business_entities (code)
  WHERE deleted_at IS NULL AND code IS NOT NULL AND btrim(code) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_business_entities_name_type
  ON public.business_entities (normalized_name, entity_type)
  WHERE deleted_at IS NULL;

-- 3) bank_accounts 规范化字段 + 唯一约束
ALTER TABLE public.bank_accounts
  ADD COLUMN IF NOT EXISTS normalized_account_no text
    GENERATED ALWAYS AS (regexp_replace(coalesce(account_no_masked,''),'\s','','g')) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_bank_accounts_account_no
  ON public.bank_accounts (normalized_account_no)
  WHERE deleted_at IS NULL AND coalesce(account_no_masked,'') <> '';

-- 4) shops 规范化字段 + 唯一约束
ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS normalized_name text
    GENERATED ALWAYS AS (lower(btrim(coalesce(name,'')))) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_shops_platform_name
  ON public.shops (platform_id, normalized_name)
  WHERE deleted_at IS NULL;

-- 5) cash_tx_categories 规范化字段 + 唯一约束
ALTER TABLE public.cash_tx_categories
  ADD COLUMN IF NOT EXISTS normalized_name text
    GENERATED ALWAYS AS (lower(btrim(coalesce(name,'')))) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_cash_tx_categories_direction_name
  ON public.cash_tx_categories (direction, normalized_name)
  WHERE deleted_at IS NULL;

-- 6) platforms.code 唯一（业务上 code 不应重复）
CREATE UNIQUE INDEX IF NOT EXISTS uniq_platforms_code
  ON public.platforms (code)
  WHERE deleted_at IS NULL;
