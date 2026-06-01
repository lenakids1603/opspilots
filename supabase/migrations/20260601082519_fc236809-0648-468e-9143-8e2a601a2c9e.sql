CREATE TABLE public.jst_shop_mappings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  jst_shop_id text NOT NULL UNIQUE,
  jst_shop_name text NOT NULL DEFAULT '',
  platform_type text NOT NULL DEFAULT '',
  platform_shop_id text NOT NULL DEFAULT '',
  shop_status text NOT NULL DEFAULT '',
  auth_status text NOT NULL DEFAULT '',
  raw_json jsonb,
  matched_shop_id uuid,
  matched_business_entity_id uuid,
  matched_platform_id uuid,
  mapping_status text NOT NULL DEFAULT 'unmapped',
  mapping_note text NOT NULL DEFAULT '',
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_jst_shop_mappings_status ON public.jst_shop_mappings(mapping_status);
CREATE INDEX idx_jst_shop_mappings_matched_shop ON public.jst_shop_mappings(matched_shop_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jst_shop_mappings TO authenticated;
GRANT ALL ON public.jst_shop_mappings TO service_role;

ALTER TABLE public.jst_shop_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal read jst_shop_mappings"
  ON public.jst_shop_mappings FOR SELECT TO authenticated
  USING (public.is_ops_internal(auth.uid()));

CREATE POLICY "admin write jst_shop_mappings"
  ON public.jst_shop_mappings FOR ALL TO authenticated
  USING (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code))
  WITH CHECK (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code));

CREATE TRIGGER trg_jst_shop_mappings_updated_at
  BEFORE UPDATE ON public.jst_shop_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();