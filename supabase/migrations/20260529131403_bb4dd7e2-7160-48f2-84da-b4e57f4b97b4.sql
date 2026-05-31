
-- 1. Add 'pending' to ops_account_type
ALTER TYPE public.ops_account_type ADD VALUE IF NOT EXISTS 'pending';
