
ALTER TABLE public.cash_transactions
  ADD COLUMN IF NOT EXISTS receipt_raw_text text,
  ADD COLUMN IF NOT EXISTS receipt_parsed_json jsonb,
  ADD COLUMN IF NOT EXISTS receipt_ai_confidence jsonb,
  ADD COLUMN IF NOT EXISTS transaction_serial_no text,
  ADD COLUMN IF NOT EXISTS counterparty_account text,
  ADD COLUMN IF NOT EXISTS counterparty_bank text,
  ADD COLUMN IF NOT EXISTS ai_matched boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_match_warnings text[];

CREATE UNIQUE INDEX IF NOT EXISTS cash_transactions_serial_no_uidx
  ON public.cash_transactions (transaction_serial_no)
  WHERE transaction_serial_no IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS cash_transactions_dedup_idx
  ON public.cash_transactions (occurred_at, amount, bank_account_id)
  WHERE deleted_at IS NULL;
