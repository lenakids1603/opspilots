ALTER TABLE public.bank_accounts
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT '收款',
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS default_bank_account_id uuid;

INSERT INTO public.platforms (code, name, status)
  VALUES ('other', '其他', 'active')
  ON CONFLICT DO NOTHING;