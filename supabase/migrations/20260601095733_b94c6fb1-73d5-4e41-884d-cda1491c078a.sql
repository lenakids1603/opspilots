ALTER TABLE public.ops_suppliers
  ADD COLUMN IF NOT EXISTS raw_jst_json jsonb,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;