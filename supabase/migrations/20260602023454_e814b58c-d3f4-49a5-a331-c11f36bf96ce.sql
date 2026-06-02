
-- 1) Backfill: 通过 shops.jst_shop_id 把财务店铺主数据同步到聚水潭店铺映射表
--    只回填未忽略且未手动绑定的行,保留已有人工映射
UPDATE public.jst_shop_mappings m
SET matched_shop_id = s.id,
    matched_business_entity_id = s.entity_id,
    matched_platform_id = s.platform_id,
    mapping_status = 'mapped',
    updated_at = now()
FROM public.shops s
WHERE s.deleted_at IS NULL
  AND s.jst_shop_id IS NOT NULL
  AND s.jst_shop_id = m.jst_shop_id
  AND m.mapping_status <> 'ignored'
  AND m.matched_shop_id IS NULL;

-- 对于已经人工绑定 matched_shop_id 的行,如果其财务店铺主体/平台有更新,也同步刷新主体/平台
UPDATE public.jst_shop_mappings m
SET matched_business_entity_id = s.entity_id,
    matched_platform_id = s.platform_id,
    updated_at = now()
FROM public.shops s
WHERE s.deleted_at IS NULL
  AND m.matched_shop_id = s.id
  AND m.mapping_status <> 'ignored'
  AND (
    m.matched_business_entity_id IS DISTINCT FROM s.entity_id
    OR m.matched_platform_id IS DISTINCT FROM s.platform_id
  );

-- 2) RPC: 让前端按钮可以触发"根据财务店铺自动匹配"
CREATE OR REPLACE FUNCTION public.jst_resync_shop_mappings_from_shops()
RETURNS TABLE(updated_count integer, mapped_after integer, unmapped_after integer, ignored_after integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
  v_mapped integer;
  v_unmapped integer;
  v_ignored integer;
BEGIN
  IF NOT public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code) THEN
    RAISE EXCEPTION '仅 admin 角色可执行';
  END IF;

  -- 通过 jst_shop_id 关联,回填未忽略行
  WITH upd AS (
    UPDATE public.jst_shop_mappings m
    SET matched_shop_id = s.id,
        matched_business_entity_id = s.entity_id,
        matched_platform_id = s.platform_id,
        mapping_status = 'mapped',
        updated_at = now()
    FROM public.shops s
    WHERE s.deleted_at IS NULL
      AND s.jst_shop_id IS NOT NULL
      AND s.jst_shop_id = m.jst_shop_id
      AND m.mapping_status <> 'ignored'
      AND (
        m.matched_shop_id IS DISTINCT FROM s.id
        OR m.matched_business_entity_id IS DISTINCT FROM s.entity_id
        OR m.matched_platform_id IS DISTINCT FROM s.platform_id
        OR m.mapping_status = 'unmapped'
      )
    RETURNING m.id
  )
  SELECT count(*) INTO v_updated FROM upd;

  SELECT
    count(*) FILTER (WHERE mapping_status = 'mapped'),
    count(*) FILTER (WHERE mapping_status = 'unmapped'),
    count(*) FILTER (WHERE mapping_status = 'ignored')
  INTO v_mapped, v_unmapped, v_ignored
  FROM public.jst_shop_mappings;

  RETURN QUERY SELECT v_updated, v_mapped, v_unmapped, v_ignored;
END;
$$;

GRANT EXECUTE ON FUNCTION public.jst_resync_shop_mappings_from_shops() TO authenticated;

-- 3) 触发器: shops 表更新 jst_shop_id / entity_id / platform_id 时,自动同步到映射表
CREATE OR REPLACE FUNCTION public.shops_sync_to_jst_mapping()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.jst_shop_id IS NULL OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.jst_shop_mappings m
  SET matched_shop_id = NEW.id,
      matched_business_entity_id = NEW.entity_id,
      matched_platform_id = NEW.platform_id,
      mapping_status = CASE WHEN m.mapping_status = 'ignored' THEN 'ignored' ELSE 'mapped' END,
      updated_at = now()
  WHERE m.jst_shop_id = NEW.jst_shop_id
    AND m.mapping_status <> 'ignored';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shops_sync_to_jst_mapping ON public.shops;
CREATE TRIGGER trg_shops_sync_to_jst_mapping
AFTER INSERT OR UPDATE OF jst_shop_id, entity_id, platform_id, deleted_at ON public.shops
FOR EACH ROW
EXECUTE FUNCTION public.shops_sync_to_jst_mapping();
