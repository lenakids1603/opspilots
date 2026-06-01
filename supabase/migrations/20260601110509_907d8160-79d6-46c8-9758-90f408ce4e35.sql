
-- 1. Add confirm/archive lifecycle columns to ops_suppliers
ALTER TABLE public.ops_suppliers
  ADD COLUMN IF NOT EXISTS confirm_status text NOT NULL DEFAULT 'unconfirmed',
  ADD COLUMN IF NOT EXISTS confirmed_by uuid,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_reason text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

ALTER TABLE public.ops_suppliers
  DROP CONSTRAINT IF EXISTS ops_suppliers_confirm_status_chk;
ALTER TABLE public.ops_suppliers
  ADD CONSTRAINT ops_suppliers_confirm_status_chk
  CHECK (confirm_status IN ('unconfirmed','confirmed','archived'));

CREATE INDEX IF NOT EXISTS ops_suppliers_confirm_status_idx
  ON public.ops_suppliers(confirm_status);

-- 2. Audit log table for confirm-status changes
CREATE TABLE IF NOT EXISTS public.ops_supplier_confirm_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL,
  old_confirm_status text NOT NULL DEFAULT '',
  new_confirm_status text NOT NULL,
  reason text NOT NULL DEFAULT '',
  operated_by uuid,
  operated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.ops_supplier_confirm_audit_logs TO authenticated;
GRANT ALL ON public.ops_supplier_confirm_audit_logs TO service_role;

ALTER TABLE public.ops_supplier_confirm_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal read supplier confirm audit"
  ON public.ops_supplier_confirm_audit_logs
  FOR SELECT TO authenticated
  USING (public.is_ops_internal(auth.uid()));

CREATE POLICY "privileged insert supplier confirm audit"
  ON public.ops_supplier_confirm_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_ops_internal(auth.uid()) AND (
      public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code) OR
      public.has_ops_role(auth.uid(), 'ops'::public.ops_role_code)
    )
  );

CREATE INDEX IF NOT EXISTS ops_supplier_confirm_audit_supplier_idx
  ON public.ops_supplier_confirm_audit_logs(supplier_id, operated_at DESC);

-- 3. Backfill existing rows
-- JST disabled -> archived
UPDATE public.ops_suppliers
SET confirm_status = 'archived',
    archived_reason = '聚水潭已停用',
    archived_at = now()
WHERE status = 'disabled' AND confirm_status = 'unconfirmed';

-- JST active stays unconfirmed (default), no-op.

-- Pre-existing legacy row (no jst_supplier_id) also stays unconfirmed per user spec.

-- Seed audit rows for the backfill
INSERT INTO public.ops_supplier_confirm_audit_logs(supplier_id, old_confirm_status, new_confirm_status, reason, operated_by)
SELECT id, '', 'archived', '回填：聚水潭已停用', NULL
FROM public.ops_suppliers
WHERE confirm_status = 'archived';

INSERT INTO public.ops_supplier_confirm_audit_logs(supplier_id, old_confirm_status, new_confirm_status, reason, operated_by)
SELECT id, '', 'unconfirmed', '回填：等待人工确认', NULL
FROM public.ops_suppliers
WHERE confirm_status = 'unconfirmed';
