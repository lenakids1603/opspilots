
-- 1. 扩展 jst_shop_mappings 字段
ALTER TABLE public.jst_shop_mappings
  ADD COLUMN IF NOT EXISTS ignore_reason text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ignored_by uuid,
  ADD COLUMN IF NOT EXISTS ignored_at timestamptz,
  ADD COLUMN IF NOT EXISTS bind_reason text NOT NULL DEFAULT '';

-- 2. 唯一性:同一 platform_shop_id 不重复(忽略空)
CREATE UNIQUE INDEX IF NOT EXISTS jst_shop_mappings_platform_shop_uidx
  ON public.jst_shop_mappings (platform_type, platform_shop_id)
  WHERE platform_shop_id <> '' AND mapping_status <> 'ignored';

-- 3. 唯一性:同一系统 shop 仅一个有效绑定
CREATE UNIQUE INDEX IF NOT EXISTS jst_shop_mappings_matched_shop_uidx
  ON public.jst_shop_mappings (matched_shop_id)
  WHERE matched_shop_id IS NOT NULL AND mapping_status = 'mapped';

-- 4. 强制 ignored 必须有原因
CREATE OR REPLACE FUNCTION public.jst_shop_mapping_validate()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.mapping_status = 'ignored' AND (NEW.ignore_reason IS NULL OR length(btrim(NEW.ignore_reason)) = 0) THEN
    RAISE EXCEPTION '忽略店铺必须填写忽略原因';
  END IF;
  IF NEW.mapping_status = 'ignored' AND NEW.ignored_at IS NULL THEN
    NEW.ignored_at := now();
  END IF;
  IF NEW.mapping_status <> 'ignored' THEN
    NEW.ignore_reason := '';
    NEW.ignored_by := NULL;
    NEW.ignored_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_jst_shop_mapping_validate ON public.jst_shop_mappings;
CREATE TRIGGER trg_jst_shop_mapping_validate
  BEFORE INSERT OR UPDATE ON public.jst_shop_mappings
  FOR EACH ROW EXECUTE FUNCTION public.jst_shop_mapping_validate();

-- 5. 审计日志表
CREATE TABLE IF NOT EXISTS public.jst_shop_mapping_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mapping_id uuid NOT NULL,
  jst_shop_id text NOT NULL DEFAULT '',
  action_type text NOT NULL,
  old_shop_id uuid, new_shop_id uuid,
  old_business_entity_id uuid, new_business_entity_id uuid,
  old_platform_id uuid, new_platform_id uuid,
  old_status text, new_status text,
  reason text NOT NULL DEFAULT '',
  operated_by uuid,
  operated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.jst_shop_mapping_audit_logs TO authenticated;
GRANT ALL ON public.jst_shop_mapping_audit_logs TO service_role;
ALTER TABLE public.jst_shop_mapping_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal read mapping audit"
  ON public.jst_shop_mapping_audit_logs FOR SELECT TO authenticated
  USING (public.is_ops_internal(auth.uid()));

CREATE POLICY "admin insert mapping audit"
  ON public.jst_shop_mapping_audit_logs FOR INSERT TO authenticated
  WITH CHECK (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code));

CREATE INDEX IF NOT EXISTS jst_shop_mapping_audit_mapping_idx
  ON public.jst_shop_mapping_audit_logs (mapping_id, operated_at DESC);

-- 6. 自动审计触发器(UPDATE 时)
CREATE OR REPLACE FUNCTION public.jst_shop_mapping_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_action text;
  v_changed boolean := false;
BEGIN
  IF OLD.matched_shop_id IS DISTINCT FROM NEW.matched_shop_id
     OR OLD.matched_business_entity_id IS DISTINCT FROM NEW.matched_business_entity_id
     OR OLD.matched_platform_id IS DISTINCT FROM NEW.matched_platform_id
     OR OLD.mapping_status IS DISTINCT FROM NEW.mapping_status THEN
    v_changed := true;
  END IF;

  IF NOT v_changed THEN RETURN NEW; END IF;

  v_action := CASE
    WHEN OLD.mapping_status <> 'ignored' AND NEW.mapping_status = 'ignored' THEN 'ignore'
    WHEN OLD.mapping_status = 'ignored' AND NEW.mapping_status <> 'ignored' THEN 'restore'
    WHEN OLD.matched_shop_id IS NULL AND NEW.matched_shop_id IS NOT NULL THEN 'bind'
    WHEN OLD.matched_shop_id IS NOT NULL AND NEW.matched_shop_id IS NULL THEN 'unbind'
    ELSE 'update'
  END;

  INSERT INTO public.jst_shop_mapping_audit_logs(
    mapping_id, jst_shop_id, action_type,
    old_shop_id, new_shop_id,
    old_business_entity_id, new_business_entity_id,
    old_platform_id, new_platform_id,
    old_status, new_status,
    reason, operated_by
  ) VALUES (
    NEW.id, NEW.jst_shop_id, v_action,
    OLD.matched_shop_id, NEW.matched_shop_id,
    OLD.matched_business_entity_id, NEW.matched_business_entity_id,
    OLD.matched_platform_id, NEW.matched_platform_id,
    OLD.mapping_status, NEW.mapping_status,
    COALESCE(NULLIF(NEW.mapping_note,''), NEW.ignore_reason, NEW.bind_reason, ''),
    auth.uid()
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_jst_shop_mapping_audit ON public.jst_shop_mappings;
CREATE TRIGGER trg_jst_shop_mapping_audit
  AFTER UPDATE ON public.jst_shop_mappings
  FOR EACH ROW EXECUTE FUNCTION public.jst_shop_mapping_audit();
